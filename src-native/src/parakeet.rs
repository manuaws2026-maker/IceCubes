//! Parakeet local transcription engine
//!
//! This module provides local speech-to-text using NVIDIA's Parakeet TDT model
//! using direct ONNX Runtime for optimal performance and text quality.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::io::{Read, Write};

// ONNX Runtime implementation
use ndarray::{Array, Array1, Array2, Array3, ArrayD, ArrayViewD, IxDyn};
use once_cell::sync::Lazy;
use ort::execution_providers::CPUExecutionProvider;
use ort::inputs;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::TensorRef;
use regex::Regex;
use std::fs;

// ============================================================================
// Parakeet Model - Direct ONNX Runtime Implementation
// ============================================================================

type DecoderState = (Array3<f32>, Array3<f32>);

const SUBSAMPLING_FACTOR: usize = 8;
const WINDOW_SIZE: f32 = 0.01;
const MAX_TOKENS_PER_STEP: usize = 10;

// Regex for decoding SentencePiece tokens
static DECODE_SPACE_RE: Lazy<Option<Regex>> =
    Lazy::new(|| Regex::new(r"\A\s|\s\B|(\s)\b").ok());

#[derive(Debug, Clone)]
pub struct TimestampedResult {
    pub text: String,
    pub timestamps: Vec<f32>,
    pub tokens: Vec<String>,
}

// Use String for internal errors, convert to napi::Error at boundaries
type ModelResult<T> = std::result::Result<T, String>;

fn ort_err(e: ort::Error) -> String { e.to_string() }
fn io_err(e: std::io::Error) -> String { e.to_string() }
fn shape_err(e: ndarray::ShapeError) -> String { e.to_string() }

/// ParakeetModel - direct ONNX Runtime implementation
struct ParakeetModel {
    encoder: Session,
    decoder_joint: Session,
    preprocessor: Session,
    vocab: Vec<String>,
    blank_idx: i32,
    vocab_size: usize,
}

impl ParakeetModel {
    fn new(model_dir: &PathBuf, quantized: bool) -> ModelResult<Self> {
        let encoder = Self::init_session(model_dir, "encoder-model", None, quantized)?;
        let decoder_joint = Self::init_session(model_dir, "decoder_joint-model", None, quantized)?;
        let preprocessor = Self::init_session(model_dir, "nemo128", None, false)?;

        let (vocab, blank_idx) = Self::load_vocab(model_dir)?;
        let vocab_size = vocab.len();

        println!(
            "[Parakeet] Loaded vocabulary with {} tokens, blank_idx={}",
            vocab_size, blank_idx
        );

        Ok(Self {
            encoder,
            decoder_joint,
            preprocessor,
            vocab,
            blank_idx,
            vocab_size,
        })
    }

    fn init_session(
        model_dir: &PathBuf,
        model_name: &str,
        intra_threads: Option<usize>,
        try_quantized: bool,
    ) -> ModelResult<Session> {
        let providers = vec![CPUExecutionProvider::default().build()];

        let model_filename = if try_quantized {
            let quantized_name = format!("{}.int8.onnx", model_name);
            let quantized_path = model_dir.join(&quantized_name);
            if quantized_path.exists() {
                println!("[Parakeet] Loading quantized model: {}", quantized_name);
                quantized_name
            } else {
                let regular_name = format!("{}.onnx", model_name);
                println!("[Parakeet] Quantized not found, loading: {}", regular_name);
                regular_name
            }
        } else {
            let regular_name = format!("{}.onnx", model_name);
            println!("[Parakeet] Loading model: {}", regular_name);
            regular_name
        };

        let mut builder = Session::builder().map_err(ort_err)?
            .with_optimization_level(GraphOptimizationLevel::Level3).map_err(ort_err)?
            .with_execution_providers(providers).map_err(ort_err)?
            .with_parallel_execution(true).map_err(ort_err)?;

        if let Some(threads) = intra_threads {
            builder = builder.with_intra_threads(threads).map_err(ort_err)?
                .with_inter_threads(threads).map_err(ort_err)?;
        }

        let session = builder.commit_from_file(model_dir.join(&model_filename)).map_err(ort_err)?;

        for input in &session.inputs {
            println!(
                "[Parakeet] Model '{}' input: name={}, type={:?}",
                model_filename, input.name, input.input_type
            );
        }

        Ok(session)
    }

    fn load_vocab(model_dir: &PathBuf) -> ModelResult<(Vec<String>, i32)> {
        let vocab_path = model_dir.join("vocab.txt");
        let content = fs::read_to_string(&vocab_path).map_err(io_err)?;

        let mut max_id = 0;
        let mut tokens_with_ids: Vec<(String, usize)> = Vec::new();
        let mut blank_idx: Option<usize> = None;

        for line in content.lines() {
            let parts: Vec<&str> = line.trim_end().split(' ').collect();
            if parts.len() >= 2 {
                let token = parts[0].to_string();
                if let Ok(id) = parts[1].parse::<usize>() {
                    if token == "<blk>" {
                        blank_idx = Some(id);
                    }
                    tokens_with_ids.push((token, id));
                    max_id = max_id.max(id);
                }
            }
        }

        // Create vocab vector with ▁ replaced with space (KEY for proper text!)
        let mut vocab = vec![String::new(); max_id + 1];
        for (token, id) in tokens_with_ids {
            vocab[id] = token.replace('\u{2581}', " ");
        }

        let blank_idx = blank_idx.ok_or_else(|| "Missing <blk> token in vocabulary".to_string())? as i32;

        Ok((vocab, blank_idx))
    }

    fn preprocess(
        &mut self,
        waveforms: &ArrayViewD<f32>,
        waveforms_lens: &ArrayViewD<i64>,
    ) -> ModelResult<(ArrayD<f32>, ArrayD<i64>)> {
        let inputs = inputs![
            "waveforms" => TensorRef::from_array_view(waveforms.view()).map_err(ort_err)?,
            "waveforms_lens" => TensorRef::from_array_view(waveforms_lens.view()).map_err(ort_err)?,
        ];
        let outputs = self.preprocessor.run(inputs).map_err(ort_err)?;

        let features = outputs.get("features").ok_or("features not found")?
            .try_extract_array().map_err(ort_err)?;
        let features_lens = outputs.get("features_lens").ok_or("features_lens not found")?
            .try_extract_array().map_err(ort_err)?;

        Ok((features.to_owned(), features_lens.to_owned()))
    }

    fn encode(
        &mut self,
        audio_signal: &ArrayViewD<f32>,
        length: &ArrayViewD<i64>,
    ) -> ModelResult<(ArrayD<f32>, ArrayD<i64>)> {
        let inputs = inputs![
            "audio_signal" => TensorRef::from_array_view(audio_signal.view()).map_err(ort_err)?,
            "length" => TensorRef::from_array_view(length.view()).map_err(ort_err)?,
        ];
        let outputs = self.encoder.run(inputs).map_err(ort_err)?;

        let encoder_output = outputs.get("outputs").ok_or("outputs not found")?
            .try_extract_array().map_err(ort_err)?;
        let encoded_lengths = outputs.get("encoded_lengths").ok_or("encoded_lengths not found")?
            .try_extract_array().map_err(ort_err)?;

        let encoder_output = encoder_output.permuted_axes(IxDyn(&[0, 2, 1]));

        Ok((encoder_output.to_owned(), encoded_lengths.to_owned()))
    }

    fn create_decoder_state(&self) -> ModelResult<DecoderState> {
        let inputs = &self.decoder_joint.inputs;

        let state1_shape = inputs.iter()
            .find(|input| input.name == "input_states_1")
            .ok_or("input_states_1 not found")?
            .input_type.tensor_shape()
            .ok_or("Failed to get input_states_1 shape")?;

        let state2_shape = inputs.iter()
            .find(|input| input.name == "input_states_2")
            .ok_or("input_states_2 not found")?
            .input_type.tensor_shape()
            .ok_or("Failed to get input_states_2 shape")?;

        let state1 = Array::zeros((state1_shape[0] as usize, 1, state1_shape[2] as usize));
        let state2 = Array::zeros((state2_shape[0] as usize, 1, state2_shape[2] as usize));

        Ok((state1, state2))
    }

    fn decode_step(
        &mut self,
        prev_tokens: &[i32],
        prev_state: &DecoderState,
        encoder_out: &ArrayViewD<f32>,
    ) -> ModelResult<(ArrayD<f32>, DecoderState)> {
        let target_token = prev_tokens.last().copied().unwrap_or(self.blank_idx);

        let encoder_outputs = encoder_out.to_owned()
            .insert_axis(ndarray::Axis(0))
            .insert_axis(ndarray::Axis(2));
        let targets = Array2::from_shape_vec((1, 1), vec![target_token]).map_err(shape_err)?;
        let target_length = Array1::from_vec(vec![1]);

        let inputs = inputs![
            "encoder_outputs" => TensorRef::from_array_view(encoder_outputs.view()).map_err(ort_err)?,
            "targets" => TensorRef::from_array_view(targets.view()).map_err(ort_err)?,
            "target_length" => TensorRef::from_array_view(target_length.view()).map_err(ort_err)?,
            "input_states_1" => TensorRef::from_array_view(prev_state.0.view()).map_err(ort_err)?,
            "input_states_2" => TensorRef::from_array_view(prev_state.1.view()).map_err(ort_err)?,
        ];

        let outputs = self.decoder_joint.run(inputs).map_err(ort_err)?;

        let logits = outputs.get("outputs").ok_or("outputs not found")?
            .try_extract_array().map_err(ort_err)?;
        let state1 = outputs.get("output_states_1").ok_or("output_states_1 not found")?
            .try_extract_array().map_err(ort_err)?;
        let state2 = outputs.get("output_states_2").ok_or("output_states_2 not found")?
            .try_extract_array().map_err(ort_err)?;

        let logits = logits.remove_axis(ndarray::Axis(0));
        let state1_3d = state1.to_owned().into_dimensionality::<ndarray::Ix3>().map_err(shape_err)?;
        let state2_3d = state2.to_owned().into_dimensionality::<ndarray::Ix3>().map_err(shape_err)?;

        Ok((logits.to_owned(), (state1_3d, state2_3d)))
    }

    fn recognize_batch(
        &mut self,
        waveforms: &ArrayViewD<f32>,
        waveforms_len: &ArrayViewD<i64>,
    ) -> ModelResult<Vec<TimestampedResult>> {
        let (features, features_lens) = self.preprocess(waveforms, waveforms_len)?;
        let (encoder_out, encoder_out_lens) = self.encode(&features.view(), &features_lens.view())?;

        let mut results = Vec::new();
        for (encodings, &encodings_len) in encoder_out.outer_iter().zip(encoder_out_lens.iter()) {
            let (tokens, timestamps) = self.decode_sequence(&encodings.view(), encodings_len as usize)?;
            let result = self.decode_tokens(tokens, timestamps);
            results.push(result);
        }

        Ok(results)
    }

    fn decode_sequence(
        &mut self,
        encodings: &ArrayViewD<f32>,
        encodings_len: usize,
    ) -> ModelResult<(Vec<i32>, Vec<usize>)> {
        let mut prev_state = self.create_decoder_state()?;
        let mut tokens = Vec::new();
        let mut timestamps = Vec::new();

        let mut t = 0;
        let mut emitted_tokens = 0;

        while t < encodings_len {
            let encoder_step = encodings.slice(ndarray::s![t, ..]);
            let encoder_step_dyn = encoder_step.to_owned().into_dyn();
            let (probs, new_state) = self.decode_step(&tokens, &prev_state, &encoder_step_dyn.view())?;

            let vocab_logits_slice = probs.as_slice().ok_or("Failed to get logits slice")?;

            let vocab_logits = if probs.len() > self.vocab_size {
                &vocab_logits_slice[..self.vocab_size]
            } else {
                vocab_logits_slice
            };

            let token = vocab_logits.iter().enumerate()
                .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(idx, _)| idx as i32)
                .unwrap_or(self.blank_idx);

            if token != self.blank_idx {
                prev_state = new_state;
                tokens.push(token);
                timestamps.push(t);
                emitted_tokens += 1;
            }

            if token == self.blank_idx || emitted_tokens == MAX_TOKENS_PER_STEP {
                t += 1;
                emitted_tokens = 0;
            }
        }

        if tokens.is_empty() {
            println!("[Parakeet] No tokens decoded for {} timesteps - audio may be silence", encodings_len);
        }

        Ok((tokens, timestamps))
    }

    fn decode_tokens(&self, ids: Vec<i32>, timestamps: Vec<usize>) -> TimestampedResult {
        let tokens: Vec<String> = ids.iter()
            .filter_map(|&id| {
                let idx = id as usize;
                if idx < self.vocab.len() { Some(self.vocab[idx].clone()) } else { None }
            })
            .collect();

        // Regex-based text cleanup
        let text = match &*DECODE_SPACE_RE {
            Some(regex) => regex
                .replace_all(&tokens.join(""), |caps: &regex::Captures| {
                    if caps.get(1).is_some() { " " } else { "" }
                })
                .to_string(),
            None => tokens.join(""),
        };

        let float_timestamps: Vec<f32> = timestamps.iter()
            .map(|&t| WINDOW_SIZE * SUBSAMPLING_FACTOR as f32 * t as f32)
            .collect();

        TimestampedResult { text, timestamps: float_timestamps, tokens }
    }

    fn transcribe_samples(&mut self, samples: Vec<f32>) -> ModelResult<String> {
        let result = self.transcribe_samples_with_timestamps(samples)?;
        Ok(result.text)
    }

    fn transcribe_samples_with_timestamps(&mut self, samples: Vec<f32>) -> ModelResult<TimestampedResult> {
        let batch_size = 1;
        let samples_len = samples.len();

        let waveforms = Array2::from_shape_vec((batch_size, samples_len), samples).map_err(shape_err)?.into_dyn();
        let waveforms_lens = Array1::from_vec(vec![samples_len as i64]).into_dyn();

        let results = self.recognize_batch(&waveforms.view(), &waveforms_lens.view())?;

        let result = results.into_iter().next().ok_or("No transcription result")?;

        Ok(result)
    }
}

// ============================================================================
// Global State and NAPI Exports
// ============================================================================

static PARAKEET_STATE: Mutex<Option<ParakeetModel>> = Mutex::new(None);

static DOWNLOAD_PROGRESS: Mutex<DownloadProgress> = Mutex::new(DownloadProgress {
    is_downloading: false,
    current_file: String::new(),
    current_file_index: 0,
    total_files: 0,
    bytes_downloaded: 0,
    total_bytes: 0,
    percent: 0,
    error: None,
});

#[napi(object)]
pub struct ParakeetModelInfo {
    pub downloaded: bool,
    pub version: String,
    pub size: i64,
    pub path: String,
}

#[napi(object)]
#[derive(Clone)]
pub struct DownloadProgress {
    pub is_downloading: bool,
    pub current_file: String,
    pub current_file_index: u32,
    pub total_files: u32,
    pub bytes_downloaded: i64,
    pub total_bytes: i64,
    pub percent: u32,
    pub error: Option<String>,
}

fn get_model_dir() -> PathBuf {
    let app_data = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ghost")
        .join("models")
        .join("parakeet-tdt-v3");
    std::fs::create_dir_all(&app_data).ok();
    app_data
}

fn check_model_files() -> bool {
    let model_dir = get_model_dir();
    let required = [
        "encoder-model.int8.onnx",
        "decoder_joint-model.int8.onnx",
        "nemo128.onnx",
        "vocab.txt"
    ];
    required.iter().all(|f| model_dir.join(f).exists())
}

#[napi]
pub fn is_parakeet_downloaded() -> bool {
    check_model_files()
}

#[napi]
pub fn get_parakeet_model_info() -> ParakeetModelInfo {
    let model_dir = get_model_dir();
    let downloaded = check_model_files();
    
    let size: i64 = if downloaded {
        std::fs::read_dir(&model_dir)
            .ok()
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|e| e.metadata().ok())
                    .map(|m| m.len() as i64)
                    .sum()
            })
            .unwrap_or(0)
    } else {
        0
    };
    
    ParakeetModelInfo {
        downloaded,
        version: "tdt-v3-int8".to_string(),
        size,
        path: model_dir.to_string_lossy().to_string(),
    }
}

#[napi]
pub fn get_parakeet_languages() -> Vec<String> {
    vec![
        "en".to_string(), "de".to_string(), "es".to_string(), "fr".to_string(),
        "it".to_string(), "pt".to_string(), "nl".to_string(), "pl".to_string(),
        "ru".to_string(), "uk".to_string(), "cs".to_string(), "sk".to_string(),
        "hu".to_string(), "ro".to_string(), "bg".to_string(), "hr".to_string(),
        "sl".to_string(), "sr".to_string(), "da".to_string(), "fi".to_string(),
        "no".to_string(), "sv".to_string(), "el".to_string(), "tr".to_string(),
        "vi".to_string(),
    ]
}

#[napi]
pub fn get_parakeet_download_progress() -> DownloadProgress {
    DOWNLOAD_PROGRESS.lock().clone()
}

fn download_file_with_progress(
    url: &str, 
    dest: &PathBuf, 
    file_index: usize,
    total_files: usize,
    expected_size: u64,
    total_expected: u64,
    bytes_so_far: &mut u64,
) -> std::result::Result<(), String> {
    let filename = dest.file_name().unwrap_or_default().to_string_lossy().to_string();
    
    {
        let mut progress = DOWNLOAD_PROGRESS.lock();
        progress.current_file = filename.clone();
        progress.current_file_index = file_index as u32;
        progress.total_files = total_files as u32;
    }
    
    println!("[Parakeet] Downloading {} -> {:?}", url, dest);
    
    let response = ureq::get(url)
        .set("User-Agent", "Mozilla/5.0 ghost-app/1.0")
        .call()
        .map_err(|e| format!("HTTP request failed: {:?}", e))?;
    
    if response.status() != 200 {
        return Err(format!("HTTP {}: {}", response.status(), response.status_text()));
    }
    
    let mut file = std::fs::File::create(dest)
        .map_err(|e| format!("Failed to create file: {:?}", e))?;
    
    let mut reader = response.into_reader();
    let mut buffer = [0u8; 65536];
    let mut file_downloaded: u64 = 0;
    
    loop {
        let bytes_read = reader.read(&mut buffer)
            .map_err(|e| format!("Failed to read: {:?}", e))?;
        
        if bytes_read == 0 {
            break;
        }
        
        file.write_all(&buffer[..bytes_read])
            .map_err(|e| format!("Failed to write: {:?}", e))?;
        
        file_downloaded += bytes_read as u64;
        *bytes_so_far += bytes_read as u64;
        
        if file_downloaded % (1024 * 1024) < 65536 {
            let mut progress = DOWNLOAD_PROGRESS.lock();
            progress.bytes_downloaded = *bytes_so_far as i64;
            progress.total_bytes = total_expected as i64;
            progress.percent = ((*bytes_so_far as f64 / total_expected as f64) * 100.0).min(99.0) as u32;
        }
    }
    
    {
        let mut progress = DOWNLOAD_PROGRESS.lock();
        progress.bytes_downloaded = *bytes_so_far as i64;
        progress.percent = ((*bytes_so_far as f64 / total_expected as f64) * 100.0).min(99.0) as u32;
    }
    
    println!("[Parakeet] ✓ Downloaded {} ({} bytes)", filename, file_downloaded);
    Ok(())
}

fn do_download() {
    println!("[Parakeet] Starting model download...");
    
    let model_dir = get_model_dir();
    let base_url = "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main";
    
    let files: Vec<(&str, String, u64)> = vec![
        ("encoder-model.int8.onnx", format!("{}/encoder-model.int8.onnx", base_url), 652_000_000),
        ("decoder_joint-model.int8.onnx", format!("{}/decoder_joint-model.int8.onnx", base_url), 18_200_000),
        ("nemo128.onnx", format!("{}/nemo128.onnx", base_url), 140_000),
        ("vocab.txt", format!("{}/vocab.txt", base_url), 93_900),
    ];
    
    let total_expected: u64 = files.iter().map(|(_, _, s)| s).sum();
    let total_files = files.len();
    let mut bytes_so_far: u64 = 0;
    
    for (index, (filename, url, expected_size)) in files.iter().enumerate() {
        let dest = model_dir.join(filename);
        
        if dest.exists() {
            let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
            if size > (*expected_size / 2) {
                println!("[Parakeet] {} already exists, skipping", filename);
                bytes_so_far += size;
                let mut progress = DOWNLOAD_PROGRESS.lock();
                progress.bytes_downloaded = bytes_so_far as i64;
                progress.percent = ((bytes_so_far as f64 / total_expected as f64) * 100.0).min(99.0) as u32;
                continue;
            }
        }
        
        if let Err(e) = download_file_with_progress(
            &url, &dest, index, total_files, *expected_size, total_expected, &mut bytes_so_far
        ) {
            let mut progress = DOWNLOAD_PROGRESS.lock();
            progress.is_downloading = false;
            progress.error = Some(format!("Failed to download {}: {}", filename, e));
            return;
        }
    }
    
    {
        let mut progress = DOWNLOAD_PROGRESS.lock();
        progress.is_downloading = false;
        progress.percent = 100;
        progress.error = None;
    }
    
    println!("[Parakeet] ✅ Model downloaded to: {:?}", model_dir);
}

#[napi]
pub fn download_parakeet_model() -> bool {
    {
        let progress = DOWNLOAD_PROGRESS.lock();
        if progress.is_downloading {
            return false;
        }
    }
    
    {
        let mut progress = DOWNLOAD_PROGRESS.lock();
        *progress = DownloadProgress {
            is_downloading: true,
            current_file: String::new(),
            current_file_index: 0,
            total_files: 4,
            bytes_downloaded: 0,
            total_bytes: 670_433_900,
            percent: 0,
            error: None,
        };
    }
    
    std::thread::spawn(|| { do_download(); });
    true
}

#[napi]
pub fn init_parakeet() -> Result<bool> {
    println!("[Parakeet] Initializing model...");
    
    let model_dir = get_model_dir();
    
    if !check_model_files() {
        return Err(Error::from_reason("Model not downloaded"));
    }
    
    println!("[Parakeet] Loading from: {:?}", model_dir);
    
    match ParakeetModel::new(&model_dir, true) {
        Ok(model) => {
            let mut state = PARAKEET_STATE.lock();
            *state = Some(model);
            println!("[Parakeet] ✅ Model initialized successfully");
            Ok(true)
        }
        Err(e) => {
            println!("[Parakeet] ❌ Init failed: {:?}", e);
            Err(Error::from_reason(format!("Init failed: {:?}", e)))
        }
    }
}

#[napi]
pub fn is_parakeet_ready() -> bool {
    PARAKEET_STATE.lock().is_some()
}

/// A segment of transcribed text with its timestamp
#[napi(object)]
#[derive(Clone)]
pub struct TranscriptSegment {
    pub text: String,
    pub start_time: f64,  // Seconds from start of audio chunk
    pub end_time: f64,    // Seconds from start of audio chunk
}

/// Result containing segments with timestamps
#[napi(object)]
#[derive(Clone)]
pub struct TranscriptWithTimestamps {
    pub segments: Vec<TranscriptSegment>,
    pub full_text: String,
}

#[napi]
pub fn transcribe_audio_buffer(audio_data: Buffer, sample_rate: Option<u32>, _channels: Option<u32>) -> Result<String> {
    let result = transcribe_audio_buffer_with_timestamps(audio_data, sample_rate, _channels)?;
    Ok(result.full_text)
}

/// Transcribe audio and return segments with timestamps
#[napi]
pub fn transcribe_audio_buffer_with_timestamps(audio_data: Buffer, sample_rate: Option<u32>, _channels: Option<u32>) -> Result<TranscriptWithTimestamps> {
    let mut state = PARAKEET_STATE.lock();
    
    let model = state.as_mut()
        .ok_or_else(|| Error::from_reason("Parakeet not initialized"))?;
    
    let audio_bytes = audio_data.as_ref();
    let source_rate = sample_rate.unwrap_or(16000);
    
    println!("[Parakeet] Processing {} bytes at {}Hz", audio_bytes.len(), source_rate);
    
    // Convert bytes to f32 samples
    let samples: Vec<f32> = audio_bytes
        .chunks_exact(2)
        .map(|chunk| {
            let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
            sample as f32 / 32768.0
        })
        .collect();
    
    // Resample to 16kHz if needed
    let samples_16k = if source_rate != 16000 {
        resample_audio(&samples, source_rate, 16000)
    } else {
        samples
    };
    
    println!("[Parakeet] Transcribing {} samples at 16kHz", samples_16k.len());
    
    match model.transcribe_samples_with_timestamps(samples_16k) {
        Ok(result) => {
            // Group tokens into segments (every ~2-3 seconds or by sentence)
            let segments = create_segments(&result);
            
            println!("[Parakeet] ✅ Result: {} chars, {} segments", result.text.len(), segments.len());
            
            Ok(TranscriptWithTimestamps {
                segments,
                full_text: result.text,
            })
        }
        Err(e) => {
            println!("[Parakeet] ❌ Transcription failed: {:?}", e);
            Err(Error::from_reason(format!("Transcription failed: {:?}", e)))
        }
    }
}

/// Create segments from timestamped tokens, grouping by ~2-3 second intervals or sentence boundaries
fn create_segments(result: &TimestampedResult) -> Vec<TranscriptSegment> {
    if result.tokens.is_empty() || result.timestamps.is_empty() {
        // Return single segment with full text if no timestamps
        if !result.text.is_empty() {
            return vec![TranscriptSegment {
                text: result.text.clone(),
                start_time: 0.0,
                end_time: 0.0,
            }];
        }
        return vec![];
    }
    
    let mut segments = Vec::new();
    let mut current_tokens: Vec<String> = Vec::new();
    let mut segment_start_time: Option<f32> = None;
    let mut last_time: f32 = 0.0;
    
    const SEGMENT_INTERVAL: f32 = 2.5; // Create new segment every ~2.5 seconds
    
    for (i, (token, &timestamp)) in result.tokens.iter().zip(result.timestamps.iter()).enumerate() {
        if segment_start_time.is_none() {
            segment_start_time = Some(timestamp);
        }
        
        current_tokens.push(token.clone());
        last_time = timestamp;
        
        // Check if we should create a new segment
        let time_since_start = timestamp - segment_start_time.unwrap_or(0.0);
        let is_sentence_end = token.ends_with('.') || token.ends_with('?') || token.ends_with('!');
        let is_last_token = i == result.tokens.len() - 1;
        
        if time_since_start >= SEGMENT_INTERVAL || is_sentence_end || is_last_token {
            // Create segment from accumulated tokens
            let segment_text = current_tokens.join("").trim().to_string();
            
            if !segment_text.is_empty() {
                segments.push(TranscriptSegment {
                    text: segment_text,
                    start_time: segment_start_time.unwrap_or(0.0) as f64,
                    end_time: last_time as f64,
                });
            }
            
            // Reset for next segment
            current_tokens.clear();
            segment_start_time = None;
        }
    }
    
    // Handle any remaining tokens
    if !current_tokens.is_empty() {
        let segment_text = current_tokens.join("").trim().to_string();
        if !segment_text.is_empty() {
            segments.push(TranscriptSegment {
                text: segment_text,
                start_time: segment_start_time.unwrap_or(0.0) as f64,
                end_time: last_time as f64,
            });
        }
    }
    
    segments
}

/// Resample audio using high-quality sinc interpolation
fn resample_audio(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || input.is_empty() {
        return input.to_vec();
    }
    
    use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
    
    let ratio = to_rate as f64 / from_rate as f64;
    
    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };
    
    let mut resampler = match SincFixedIn::<f32>::new(ratio, 2.0, params, input.len(), 1) {
        Ok(r) => r,
        Err(_) => return input.to_vec(),
    };
    
    let waves_in = vec![input.to_vec()];
    match resampler.process(&waves_in, None) {
        Ok(waves_out) => waves_out.into_iter().next().unwrap_or_default(),
        Err(_) => input.to_vec(),
    }
}

#[napi]
pub fn delete_parakeet_model() -> Result<bool> {
    {
        let mut state = PARAKEET_STATE.lock();
        *state = None;
    }
    
    let model_dir = get_model_dir();
    if model_dir.exists() {
        match std::fs::remove_dir_all(&model_dir) {
            Ok(_) => {
                println!("[Parakeet] ✅ Model deleted");
                Ok(true)
            }
            Err(e) => Err(Error::from_reason(format!("Delete failed: {:?}", e)))
        }
    } else {
        Ok(true)
    }
}

#[napi]
pub fn get_parakeet_model_path() -> String {
    get_model_dir().to_string_lossy().to_string()
}

#[napi]
pub fn shutdown_parakeet() {
    let mut state = PARAKEET_STATE.lock();
    *state = None;
    println!("[Parakeet] Shutdown complete");
}
