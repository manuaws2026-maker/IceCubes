//! Local Embedding Engine
//!
//! This module provides local text embeddings using the all-MiniLM-L6-v2 model
//! via ONNX Runtime. Generates 384-dimensional embeddings for semantic search.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::io::{Read, Write};

use ndarray::{Array2, ArrayD, IxDyn};
use once_cell::sync::Lazy;
use ort::execution_providers::CPUExecutionProvider;
use ort::inputs;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::TensorRef;
use std::fs;
use std::collections::HashMap;

// ============================================================================
// Constants
// ============================================================================

const EMBEDDING_DIM: usize = 384;
const MAX_SEQUENCE_LENGTH: usize = 512;

// Model files from HuggingFace
const MODEL_REPO: &str = "sentence-transformers/all-MiniLM-L6-v2";
const MODEL_FILES: &[(&str, &str, u64)] = &[
    ("model.onnx", "onnx/model.onnx", 90_900_000),
    ("tokenizer.json", "tokenizer.json", 711_000),
    ("vocab.txt", "vocab.txt", 232_000),
];

// ============================================================================
// Types
// ============================================================================

type ModelResult<T> = std::result::Result<T, String>;

fn ort_err(e: ort::Error) -> String { e.to_string() }
fn io_err(e: std::io::Error) -> String { e.to_string() }

// ============================================================================
// Download Progress Tracking
// ============================================================================

#[napi(object)]
#[derive(Clone, Default)]
pub struct EmbeddingDownloadProgress {
    pub is_downloading: bool,
    pub current_file: String,
    pub current_file_index: u32,
    pub total_files: u32,
    pub bytes_downloaded: i64,
    pub total_bytes: i64,
    pub percent: u32,
    pub error: Option<String>,
}

static DOWNLOAD_PROGRESS: Lazy<Mutex<EmbeddingDownloadProgress>> = 
    Lazy::new(|| Mutex::new(EmbeddingDownloadProgress::default()));

// ============================================================================
// Tokenizer
// ============================================================================

struct SimpleTokenizer {
    vocab: HashMap<String, i64>,
    unk_token_id: i64,
    cls_token_id: i64,
    sep_token_id: i64,
    pad_token_id: i64,
}

impl SimpleTokenizer {
    fn from_vocab_file(vocab_path: &PathBuf) -> ModelResult<Self> {
        let content = fs::read_to_string(vocab_path).map_err(io_err)?;
        let mut vocab = HashMap::new();
        
        for (idx, line) in content.lines().enumerate() {
            vocab.insert(line.to_string(), idx as i64);
        }
        
        let unk_token_id = *vocab.get("[UNK]").unwrap_or(&0);
        let cls_token_id = *vocab.get("[CLS]").unwrap_or(&101);
        let sep_token_id = *vocab.get("[SEP]").unwrap_or(&102);
        let pad_token_id = *vocab.get("[PAD]").unwrap_or(&0);
        
        Ok(Self {
            vocab,
            unk_token_id,
            cls_token_id,
            sep_token_id,
            pad_token_id,
        })
    }
    
    fn tokenize(&self, text: &str, max_length: usize) -> (Vec<i64>, Vec<i64>, Vec<i64>) {
        // Simple wordpiece-like tokenization
        let text = text.to_lowercase();
        let mut input_ids = vec![self.cls_token_id];
        let mut attention_mask = vec![1i64];
        
        // Split on whitespace and punctuation
        for word in text.split(|c: char| c.is_whitespace() || c.is_ascii_punctuation()) {
            if word.is_empty() { continue; }
            
            // Try to find the word in vocab, otherwise split into subwords
            if let Some(&id) = self.vocab.get(word) {
                if input_ids.len() < max_length - 1 {
                    input_ids.push(id);
                    attention_mask.push(1);
                }
            } else {
                // Try character-level fallback with ## prefix
                let mut remaining = word;
                let mut is_first = true;
                
                while !remaining.is_empty() && input_ids.len() < max_length - 1 {
                    let mut found = false;
                    
                    // Get character boundary indices for safe UTF-8 slicing
                    let char_indices: Vec<usize> = remaining.char_indices().map(|(i, _)| i).collect();
                    let char_count = char_indices.len();
                    
                    // Try progressively shorter substrings (by character count, not bytes)
                    for num_chars in (1..=char_count).rev() {
                        let end_byte = if num_chars == char_count {
                            remaining.len()
                        } else {
                            char_indices[num_chars]
                        };
                        let substr = &remaining[..end_byte];
                        let lookup = if is_first {
                            substr.to_string()
                        } else {
                            format!("##{}", substr)
                        };
                        
                        if let Some(&id) = self.vocab.get(&lookup) {
                            input_ids.push(id);
                            attention_mask.push(1);
                            remaining = &remaining[end_byte..];
                            is_first = false;
                            found = true;
                            break;
                        }
                    }
                    
                    if !found {
                        // Use UNK token for unknown character, skip one character (not one byte)
                        input_ids.push(self.unk_token_id);
                        attention_mask.push(1);
                        let first_char_len = remaining.chars().next().map(|c| c.len_utf8()).unwrap_or(1);
                        remaining = &remaining[first_char_len..];
                        is_first = false;
                    }
                }
            }
        }
        
        // Add SEP token
        if input_ids.len() < max_length {
            input_ids.push(self.sep_token_id);
            attention_mask.push(1);
        }
        
        // Pad to max_length
        while input_ids.len() < max_length {
            input_ids.push(self.pad_token_id);
            attention_mask.push(0);
        }
        
        // Token type IDs (all zeros for single sequence)
        let token_type_ids = vec![0i64; max_length];
        
        (input_ids, attention_mask, token_type_ids)
    }
}

// ============================================================================
// Embedding Model
// ============================================================================

struct EmbeddingModel {
    session: Session,
    tokenizer: SimpleTokenizer,
}

impl EmbeddingModel {
    fn new(model_dir: &PathBuf) -> ModelResult<Self> {
        let model_path = model_dir.join("model.onnx");
        let vocab_path = model_dir.join("vocab.txt");
        
        println!("[Embedding] Loading model from: {:?}", model_path);
        
        let providers = vec![CPUExecutionProvider::default().build()];
        
        let session = Session::builder()
            .map_err(ort_err)?
            .with_execution_providers(providers)
            .map_err(ort_err)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(ort_err)?
            .with_intra_threads(4)
            .map_err(ort_err)?
            .commit_from_file(&model_path)
            .map_err(ort_err)?;
        
        let tokenizer = SimpleTokenizer::from_vocab_file(&vocab_path)?;
        
        println!("[Embedding] Model loaded successfully");
        
        Ok(Self { session, tokenizer })
    }
    
    fn generate_embedding(&mut self, text: &str) -> ModelResult<Vec<f32>> {
        let (input_ids, attention_mask, token_type_ids) = 
            self.tokenizer.tokenize(text, MAX_SEQUENCE_LENGTH);
        
        // Create input tensors as dynamic arrays
        let input_ids_array: ArrayD<i64> = Array2::from_shape_vec((1, MAX_SEQUENCE_LENGTH), input_ids)
            .map_err(|e| e.to_string())?.into_dyn();
        let attention_mask_array: ArrayD<i64> = Array2::from_shape_vec((1, MAX_SEQUENCE_LENGTH), attention_mask)
            .map_err(|e| e.to_string())?.into_dyn();
        let token_type_ids_array: ArrayD<i64> = Array2::from_shape_vec((1, MAX_SEQUENCE_LENGTH), token_type_ids)
            .map_err(|e| e.to_string())?.into_dyn();
        
        // Run inference using TensorRef like parakeet does
        let model_inputs = inputs![
            "input_ids" => TensorRef::from_array_view(input_ids_array.view()).map_err(ort_err)?,
            "attention_mask" => TensorRef::from_array_view(attention_mask_array.view()).map_err(ort_err)?,
            "token_type_ids" => TensorRef::from_array_view(token_type_ids_array.view()).map_err(ort_err)?
        ];
        
        let outputs = self.session.run(model_inputs).map_err(ort_err)?;
        
        // Get the sentence embedding - the model outputs "last_hidden_state"
        // For MiniLM, the output is typically last_hidden_state with shape [batch, seq, hidden]
        let output_name = outputs.iter()
            .map(|(name, _)| name.to_string())
            .find(|n| n.contains("last_hidden_state") || n.contains("embedding") || n.contains("output"))
            .unwrap_or_else(|| outputs.iter().next().map(|(n, _)| n.to_string()).unwrap_or_default());
        
        let output_tensor = outputs.get(&output_name)
            .ok_or_else(|| format!("No output found. Available outputs: {:?}", 
                outputs.iter().map(|(n, _)| n.to_string()).collect::<Vec<_>>()))?
            .try_extract_array::<f32>()
            .map_err(ort_err)?;
        
        let dims = output_tensor.shape();
        
        // Mean pooling: average across sequence length dimension
        let embedding = if dims.len() == 3 {
            // Shape: [1, seq_len, hidden_size] -> mean over seq_len
            let seq_len = dims[1];
            let hidden_size = dims[2];
            
            // Get the attention mask we used
            let (_, attention_mask_vec, _) = self.tokenizer.tokenize(text, MAX_SEQUENCE_LENGTH);
            
            let mut pooled = vec![0.0f32; hidden_size];
            let mut count = 0.0f32;
            
            for i in 0..seq_len {
                // Only pool where attention mask is 1
                if attention_mask_vec.get(i).copied().unwrap_or(0) == 1 {
                    for j in 0..hidden_size {
                        pooled[j] += output_tensor[[0, i, j]];
                    }
                    count += 1.0;
                }
            }
            
            // Normalize by count
            for v in &mut pooled {
                *v /= count.max(1.0);
            }
            
            // L2 normalize the embedding
            let norm: f32 = pooled.iter().map(|x| x * x).sum::<f32>().sqrt();
            if norm > 0.0 {
                for v in &mut pooled {
                    *v /= norm;
                }
            }
            
            pooled
        } else if dims.len() == 2 {
            // Shape: [1, hidden_size] - already pooled
            let hidden_size = dims[1];
            let mut embedding: Vec<f32> = (0..hidden_size).map(|i| output_tensor[[0, i]]).collect();
            
            // L2 normalize
            let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
            if norm > 0.0 {
                for v in &mut embedding {
                    *v /= norm;
                }
            }
            
            embedding
        } else {
            return Err(format!("Unexpected output shape: {:?}", dims));
        };
        
        Ok(embedding)
    }
}

// Global model state
static EMBEDDING_MODEL: Lazy<Mutex<Option<EmbeddingModel>>> = 
    Lazy::new(|| Mutex::new(None));

// ============================================================================
// Path Utilities
// ============================================================================

fn get_model_dir() -> PathBuf {
    let cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ghost")
        .join("embedding-model");
    
    fs::create_dir_all(&cache_dir).ok();
    cache_dir
}

fn check_model_files() -> bool {
    let model_dir = get_model_dir();
    
    for (filename, _, min_size) in MODEL_FILES {
        let path = model_dir.join(filename);
        if !path.exists() {
            return false;
        }
        if let Ok(meta) = fs::metadata(&path) {
            // Check if file is at least half expected size
            if meta.len() < min_size / 2 {
                return false;
            }
        }
    }
    
    true
}

// ============================================================================
// Download Functions
// ============================================================================

fn download_file_with_progress(
    url: &str,
    dest: &PathBuf,
    file_index: usize,
    total_files: usize,
    expected_size: u64,
    total_expected: u64,
    bytes_so_far: &mut u64,
) -> ModelResult<()> {
    let filename = dest.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");
    
    println!("[Embedding] Downloading {}", url);
    
    {
        let mut progress = DOWNLOAD_PROGRESS.lock();
        progress.current_file = filename.to_string();
        progress.current_file_index = file_index as u32;
        progress.total_files = total_files as u32;
    }
    
    let response = ureq::get(url)
        .call()
        .map_err(|e| format!("HTTP error: {}", e))?;
    
    let content_length = response.header("content-length")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(expected_size);
    
    let mut reader = response.into_reader();
    let mut file = fs::File::create(dest).map_err(io_err)?;
    
    let mut buffer = [0u8; 65536];
    let mut file_downloaded: u64 = 0;
    
    loop {
        let bytes_read = reader.read(&mut buffer).map_err(io_err)?;
        if bytes_read == 0 { break; }
        
        file.write_all(&buffer[..bytes_read]).map_err(io_err)?;
        file_downloaded += bytes_read as u64;
        *bytes_so_far += bytes_read as u64;
        
        let mut progress = DOWNLOAD_PROGRESS.lock();
        progress.bytes_downloaded = *bytes_so_far as i64;
        progress.percent = ((*bytes_so_far as f64 / total_expected as f64) * 100.0).min(99.0) as u32;
    }
    
    println!("[Embedding] ✓ Downloaded {} ({} bytes)", filename, file_downloaded);
    Ok(())
}

fn do_download() {
    println!("[Embedding] Starting model download...");
    
    let model_dir = get_model_dir();
    let base_url = format!("https://huggingface.co/{}/resolve/main", MODEL_REPO);
    
    let files: Vec<(&str, String, u64)> = MODEL_FILES.iter()
        .map(|(name, path, size)| (*name, format!("{}/{}", base_url, path), *size))
        .collect();
    
    let total_expected: u64 = files.iter().map(|(_, _, s)| s).sum();
    let total_files = files.len();
    let mut bytes_so_far: u64 = 0;
    
    for (index, (filename, url, expected_size)) in files.iter().enumerate() {
        let dest = model_dir.join(filename);
        
        // Skip if already downloaded
        if dest.exists() {
            let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
            if size > (*expected_size / 2) {
                println!("[Embedding] {} already exists, skipping", filename);
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
    
    println!("[Embedding] ✅ Model downloaded to: {:?}", model_dir);
}

// ============================================================================
// Public API (NAPI exports)
// ============================================================================

#[napi]
pub fn is_embedding_downloaded() -> bool {
    check_model_files()
}

#[napi]
pub fn download_embedding_model() -> bool {
    {
        let progress = DOWNLOAD_PROGRESS.lock();
        if progress.is_downloading {
            return false;
        }
    }
    
    {
        let mut progress = DOWNLOAD_PROGRESS.lock();
        *progress = EmbeddingDownloadProgress {
            is_downloading: true,
            current_file: String::new(),
            current_file_index: 0,
            total_files: MODEL_FILES.len() as u32,
            bytes_downloaded: 0,
            total_bytes: MODEL_FILES.iter().map(|(_, _, s)| *s as i64).sum(),
            percent: 0,
            error: None,
        };
    }
    
    std::thread::spawn(|| { do_download(); });
    true
}

#[napi]
pub fn get_embedding_download_progress() -> EmbeddingDownloadProgress {
    DOWNLOAD_PROGRESS.lock().clone()
}

#[napi]
pub fn init_embedding_model() -> Result<bool> {
    println!("[Embedding] Initializing model...");
    
    let model_dir = get_model_dir();
    
    if !check_model_files() {
        return Err(Error::from_reason("Model not downloaded"));
    }
    
    println!("[Embedding] Loading from: {:?}", model_dir);
    
    match EmbeddingModel::new(&model_dir) {
        Ok(model) => {
            let mut state = EMBEDDING_MODEL.lock();
            *state = Some(model);
            println!("[Embedding] ✅ Model initialized successfully");
            Ok(true)
        }
        Err(e) => {
            println!("[Embedding] ❌ Init failed: {:?}", e);
            Err(Error::from_reason(format!("Init failed: {:?}", e)))
        }
    }
}

#[napi]
pub fn is_embedding_ready() -> bool {
    EMBEDDING_MODEL.lock().is_some()
}

#[napi]
pub fn generate_embedding(text: String) -> Result<Vec<f64>> {
    let mut state = EMBEDDING_MODEL.lock();
    let model = state.as_mut()
        .ok_or_else(|| Error::from_reason("Embedding model not initialized"))?;
    
    let embedding = model.generate_embedding(&text)
        .map_err(|e| Error::from_reason(e))?;
    
    // Convert f32 to f64 for JavaScript compatibility
    Ok(embedding.iter().map(|&x| x as f64).collect())
}

#[napi]
pub fn generate_embeddings_batch(texts: Vec<String>) -> Result<Vec<Vec<f64>>> {
    let mut state = EMBEDDING_MODEL.lock();
    let model = state.as_mut()
        .ok_or_else(|| Error::from_reason("Embedding model not initialized"))?;
    
    let mut results = Vec::with_capacity(texts.len());
    
    for text in texts {
        let embedding = model.generate_embedding(&text)
            .map_err(|e| Error::from_reason(e))?;
        results.push(embedding.iter().map(|&x| x as f64).collect());
    }
    
    Ok(results)
}

#[napi]
pub fn delete_embedding_model() -> bool {
    let model_dir = get_model_dir();
    
    // Clear the loaded model
    {
        let mut state = EMBEDDING_MODEL.lock();
        *state = None;
    }
    
    // Delete the model directory
    if model_dir.exists() {
        fs::remove_dir_all(&model_dir).is_ok()
    } else {
        true
    }
}

#[napi]
pub fn get_embedding_dimension() -> u32 {
    EMBEDDING_DIM as u32
}

