//! macOS audio capture using ScreenCaptureKit + AVFoundation microphone
//!
//! NEW APPROACH (Granola-style):
//! - System audio via ScreenCaptureKit loopback (all audio output)
//! - Microphone audio via AVFoundation (user's voice)
//! - Package as STEREO: Left = System, Right = Mic
//! - Stream in real-time for live transcription
//! - Also save to WAV at the end

use crate::audio::{AudioError, WavHeader};
use cocoa::base::{id, nil, BOOL, NO, YES};
use objc::declare::ClassDecl;
use objc::runtime::{Class, Object, Sel};
use objc::{class, msg_send, sel, sel_impl};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::ffi::c_void;
use std::fs::File;
use std::io::Write;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU64, Ordering};

// ============================================================================
// FFI
// ============================================================================

#[link(name = "ScreenCaptureKit", kind = "framework")]
extern "C" {}

#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    fn CMSampleBufferGetDataBuffer(sbuf: id) -> id;
    fn CMBlockBufferGetDataLength(block: id) -> usize;
    fn CMBlockBufferCopyDataBytes(block: id, offset: usize, len: usize, dest: *mut c_void) -> i32;
    fn CMSampleBufferGetFormatDescription(sbuf: id) -> id;
}

#[link(name = "AudioToolbox", kind = "framework")]
extern "C" {
    fn CMAudioFormatDescriptionGetStreamBasicDescription(
        desc: id,
    ) -> *const AudioStreamBasicDescription;
}

extern "C" {
    fn dispatch_get_global_queue(identifier: i64, flags: u64) -> id;
    fn dispatch_semaphore_create(value: i64) -> *mut c_void;
    fn dispatch_semaphore_signal(dsema: *mut c_void) -> i64;
    fn dispatch_semaphore_wait(dsema: *mut c_void, timeout: u64) -> i64;
    fn dispatch_time(when: u64, delta: i64) -> u64;
}

const QOS_CLASS_USER_INITIATED: i64 = 0x19;
const DISPATCH_TIME_NOW: u64 = 0;
const DISPATCH_TIME_FOREVER: u64 = !0;
const NSEC_PER_SEC: i64 = 1_000_000_000;

#[repr(C)]
struct AudioStreamBasicDescription {
    sample_rate: f64,
    format_id: u32,
    format_flags: u32,
    bytes_per_packet: u32,
    frames_per_packet: u32,
    bytes_per_frame: u32,
    channels_per_frame: u32,
    bits_per_channel: u32,
    reserved: u32,
}

// ============================================================================
// Global State
// ============================================================================

static CURRENT_LEVEL: Mutex<f64> = Mutex::new(0.0);
static IS_CAPTURING: AtomicBool = AtomicBool::new(false);
static SAMPLE_RATE: AtomicU64 = AtomicU64::new(48000);
static CHANNELS: AtomicU64 = AtomicU64::new(2);

// Separate buffers for system and mic audio (for WAV saving)
static SYSTEM_AUDIO_DATA: Mutex<Vec<u8>> = Mutex::new(Vec::new());  // System audio (float32)
static MIC_AUDIO_DATA: Mutex<Vec<u8>> = Mutex::new(Vec::new());     // Microphone audio (float32)

// Real-time stereo chunks for streaming to Deepgram
// Each chunk is already formatted as stereo 16-bit PCM (L=system, R=mic)
static AUDIO_CHUNK_QUEUE: Mutex<VecDeque<Vec<u8>>> = Mutex::new(VecDeque::new());

// Intermediate buffers for building stereo chunks
static SYSTEM_BUFFER: Mutex<Vec<f32>> = Mutex::new(Vec::new());
static MIC_BUFFER: Mutex<Vec<f32>> = Mutex::new(Vec::new());

static ACTIVE_STREAM: AtomicPtr<Object> = AtomicPtr::new(null_mut());
static ACTIVE_DELEGATE: AtomicPtr<Object> = AtomicPtr::new(null_mut());
static MIC_ENGINE: AtomicPtr<Object> = AtomicPtr::new(null_mut());

// Shared state for callbacks
static CB_CONTENT: AtomicPtr<Object> = AtomicPtr::new(null_mut());
static CB_ERROR: AtomicBool = AtomicBool::new(false);
static CB_START_OK: AtomicBool = AtomicBool::new(false);

pub struct AudioStreamHandle {
    pub output_path: String,
}

unsafe impl Send for AudioStreamHandle {}
unsafe impl Sync for AudioStreamHandle {}

pub fn get_current_level() -> f64 {
    *CURRENT_LEVEL.lock()
}

/// Get queued stereo audio chunks for streaming to Deepgram
/// Returns Vec of stereo 16-bit PCM chunks (interleaved L=system, R=mic)
pub fn get_audio_chunks() -> Vec<Vec<u8>> {
    let mut queue = AUDIO_CHUNK_QUEUE.lock();
    queue.drain(..).collect()
}

/// Check if we have audio chunks ready
pub fn has_audio_chunks() -> bool {
    !AUDIO_CHUNK_QUEUE.lock().is_empty()
}

// ============================================================================
// Stereo Chunk Builder
// ============================================================================

// Build STEREO chunks: Left = System audio (others), Right = Mic (you)
// This is sent to Deepgram with multichannel=true for proper speaker separation
static CHUNK_BUILD_COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn build_stereo_chunks() {
    let mut system = SYSTEM_BUFFER.lock();
    let mut mic = MIC_BUFFER.lock();
    
    if system.is_empty() && mic.is_empty() {
        return;
    }
    
    // Log periodically to monitor audio capture
    let count = CHUNK_BUILD_COUNT.fetch_add(1, Ordering::SeqCst);
    if count % 50 == 0 {
        println!("[Audio] Building stereo chunks - System: {} samples, Mic: {} samples", 
            system.len(), mic.len());
    }
    
    // Target ~100ms chunks at 16kHz = 1600 samples per channel
    let chunk_size = 1600;
    
    // Process when either buffer has enough data
    while system.len() >= chunk_size || mic.len() >= chunk_size {
        let samples_to_process = chunk_size.min(system.len().max(mic.len()));
        
        // Build STEREO 16-bit PCM: [L0, R0, L1, R1, ...]
        // Left = System audio (other participants)
        // Right = Mic audio (you)
        let mut stereo_chunk: Vec<u8> = Vec::with_capacity(samples_to_process * 4); // 2 bytes * 2 channels
        
        for i in 0..samples_to_process {
            // Left channel = System audio (what you hear - other participants)
            let left_sample = if i < system.len() { system[i] } else { 0.0 };
            let left_i16 = (left_sample.clamp(-1.0, 1.0) * 32767.0) as i16;
            stereo_chunk.extend_from_slice(&left_i16.to_le_bytes());
            
            // Right channel = Mic audio (your voice) - boost slightly
            let right_sample = if i < mic.len() { mic[i] * 1.5 } else { 0.0 };
            let right_i16 = (right_sample.clamp(-1.0, 1.0) * 32767.0) as i16;
            stereo_chunk.extend_from_slice(&right_i16.to_le_bytes());
        }
        
        // Queue the chunk
        AUDIO_CHUNK_QUEUE.lock().push_back(stereo_chunk);
        
        // Remove processed samples
        if samples_to_process <= system.len() {
            system.drain(..samples_to_process);
        } else {
            system.clear();
        }
        if samples_to_process <= mic.len() {
            mic.drain(..samples_to_process);
        } else {
            mic.clear();
        }
    }
}

// ============================================================================
// SCK Audio Delegate (for system audio - loopback)
// ============================================================================

fn get_delegate_class() -> *const Class {
    static mut CLS: *const Class = null_mut();
    static INIT: std::sync::Once = std::sync::Once::new();

    unsafe {
        INIT.call_once(|| {
            let super_cls = class!(NSObject);
            let mut decl = ClassDecl::new("CocoAudioDelegate", super_cls).unwrap();
            decl.add_method(
                sel!(stream:didOutputSampleBuffer:ofType:),
                on_system_audio as extern "C" fn(&Object, Sel, id, id, i64),
            );
            CLS = decl.register();
        });
        CLS
    }
}

static SYSTEM_CALLBACK_COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[allow(deprecated)]
extern "C" fn on_system_audio(_: &Object, _: Sel, _: id, sample: id, typ: i64) {
    if typ != 1 { return; } // SCStreamOutputTypeAudio = 1

    unsafe {
        let block = CMSampleBufferGetDataBuffer(sample);
        if block.is_null() { return; }

        let len = CMBlockBufferGetDataLength(block);
        if len == 0 { return; }

        let mut data = vec![0u8; len];
        if CMBlockBufferCopyDataBytes(block, 0, len, data.as_mut_ptr() as *mut c_void) != 0 {
            return;
        }

        let fmt = CMSampleBufferGetFormatDescription(sample);
        if !fmt.is_null() {
            let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fmt);
            if !asbd.is_null() {
                SAMPLE_RATE.store((*asbd).sample_rate as u64, Ordering::SeqCst);
                CHANNELS.store((*asbd).channels_per_frame as u64, Ordering::SeqCst);
            }
        }

        // Calculate level for UI feedback
        *CURRENT_LEVEL.lock() = calc_level(&data);

        if IS_CAPTURING.load(Ordering::SeqCst) {
            // Store raw data for WAV file
            SYSTEM_AUDIO_DATA.lock().extend_from_slice(&data);
            
            // Convert float32 to f32 samples and add to buffer for real-time streaming
            // System audio is stereo (2 channels), we'll take left channel or mix
            let channels = CHANNELS.load(Ordering::SeqCst) as usize;
            let source_rate = SAMPLE_RATE.load(Ordering::SeqCst) as f64;
            let target_rate = 16000.0; // Deepgram expects 16kHz
            
            let float_samples: Vec<f32> = data
                .chunks_exact(4)
                .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                .collect();
            
            // Mix stereo to mono and resample to 16kHz
            let mono_samples: Vec<f32> = if channels == 2 {
                float_samples.chunks(2)
                    .map(|pair| (pair[0] + pair.get(1).unwrap_or(&0.0)) / 2.0)
                    .collect()
            } else {
                float_samples
            };
            
            // Simple resampling (linear interpolation)
            let resample_ratio = target_rate / source_rate;
            let output_len = (mono_samples.len() as f64 * resample_ratio) as usize;
            let mut resampled: Vec<f32> = Vec::with_capacity(output_len);
            
            for i in 0..output_len {
                let src_pos = i as f64 / resample_ratio;
                let src_idx = src_pos as usize;
                let frac = src_pos - src_idx as f64;
                
                let s0 = mono_samples.get(src_idx).copied().unwrap_or(0.0);
                let s1 = mono_samples.get(src_idx + 1).copied().unwrap_or(s0);
                resampled.push(s0 + (s1 - s0) * frac as f32);
            }
            
            SYSTEM_BUFFER.lock().extend(resampled);
            
            // Build stereo chunks periodically
            let count = SYSTEM_CALLBACK_COUNT.fetch_add(1, Ordering::SeqCst);
            if count % 5 == 0 { // Every 5 callbacks (~100ms)
                build_stereo_chunks();
            }
            
            if count % 100 == 0 {
                let total = SYSTEM_AUDIO_DATA.lock().len();
                println!("[Audio] System callbacks: {}, bytes: {} ({:.1}s)", 
                    count, total, total as f64 / (48000.0 * 2.0 * 4.0));
            }
        }
    }
}

fn calc_level(data: &[u8]) -> f64 {
    if data.len() < 4 { return 0.0; }
    let samples: Vec<f32> = data
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    if samples.is_empty() { return 0.0; }
    let sq: f64 = samples.iter().map(|s| (*s as f64).powi(2)).sum();
    ((sq / samples.len() as f64).sqrt() * 2.0).min(1.0)
}

// ============================================================================
// Microphone capture using AVAudioEngine
// ============================================================================

#[allow(deprecated)]
unsafe fn start_microphone_capture() -> Result<(), AudioError> {
    println!("[Audio] Starting microphone capture...");
    
    // Create AVAudioEngine
    let engine: id = msg_send![class!(AVAudioEngine), new];
    if engine.is_null() {
        return Err(AudioError::StreamCreationFailed("Failed to create AVAudioEngine".into()));
    }
    
    // Get input node
    let input_node: id = msg_send![engine, inputNode];
    if input_node.is_null() {
        let _: () = msg_send![engine, release];
        return Err(AudioError::StreamCreationFailed("No input node".into()));
    }
    
    // DISABLED Voice Processing - it causes speaker volume to dip on macOS
    // We don't need echo cancellation because we capture system audio and mic separately
    // on different channels, and Deepgram processes them independently
    let vp_enabled: BOOL = NO;
    let vp_result: BOOL = msg_send![input_node, setVoiceProcessingEnabled: vp_enabled error: std::ptr::null_mut::<id>()];
    if vp_result == YES {
        println!("[Audio] Voice Processing DISABLED (prevents volume dipping)");
    } else {
        println!("[Audio] Voice Processing was already disabled");
    }
    
    // Get the input format
    let bus: u64 = 0;
    let format: id = msg_send![input_node, inputFormatForBus: bus];
    if format.is_null() {
        let _: () = msg_send![engine, release];
        return Err(AudioError::StreamCreationFailed("No input format".into()));
    }
    
    let sample_rate: f64 = msg_send![format, sampleRate];
    let channels: u32 = msg_send![format, channelCount];
    println!("[Audio] Mic input format: {}Hz, {} channels", sample_rate, channels);
    
    // Install tap on input node to receive audio
    let buffer_size: u32 = 4096;
    let mic_sample_rate = sample_rate;
    
    // Counter for mic callbacks
    static MIC_CALLBACK_COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    
    // Create the tap block
    let tap_block = block::ConcreteBlock::new(move |buffer: id, _when: id| {
        if !IS_CAPTURING.load(Ordering::SeqCst) { return; }
        
        // Get float channel data
        let float_data: *const *const f32 = msg_send![buffer, floatChannelData];
        if float_data.is_null() { return; }
        
        let frame_length: u32 = msg_send![buffer, frameLength];
        if frame_length == 0 { return; }
        
        // Copy mono channel (or first channel of stereo)
        let channel_data = *float_data;
        let samples = std::slice::from_raw_parts(channel_data, frame_length as usize);
        
        // Store raw for WAV file
        let bytes: Vec<u8> = samples.iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        MIC_AUDIO_DATA.lock().extend_from_slice(&bytes);
        
        // Resample to 16kHz for Deepgram streaming
        let target_rate = 16000.0;
        let resample_ratio = target_rate / mic_sample_rate;
        let output_len = (samples.len() as f64 * resample_ratio) as usize;
        let mut resampled: Vec<f32> = Vec::with_capacity(output_len);
        
        for i in 0..output_len {
            let src_pos = i as f64 / resample_ratio;
            let src_idx = src_pos as usize;
            let frac = src_pos - src_idx as f64;
            
            let s0 = samples.get(src_idx).copied().unwrap_or(0.0);
            let s1 = samples.get(src_idx + 1).copied().unwrap_or(s0);
            resampled.push(s0 + (s1 - s0) * frac as f32);
        }
        
        MIC_BUFFER.lock().extend(resampled);
        
        // Build audio chunks periodically (important: this ensures mic audio gets processed
        // even if system audio isn't being captured)
        let count = MIC_CALLBACK_COUNT.fetch_add(1, Ordering::SeqCst);
        if count % 5 == 0 { // Every ~100ms
            build_stereo_chunks();
        }
        
        if count % 100 == 0 {
            let mic_len = MIC_BUFFER.lock().len();
            let sys_len = SYSTEM_BUFFER.lock().len();
            println!("[Audio] Mic callbacks: {}, Mic buffer: {}, System buffer: {}", 
                count, mic_len, sys_len);
        }
    });
    let tap_block = tap_block.copy();
    
    let _: () = msg_send![input_node, installTapOnBus:bus bufferSize:buffer_size format:format block:&*tap_block];
    
    // Start the engine
    let mut error: id = nil;
    let started: BOOL = msg_send![engine, startAndReturnError:&mut error];
    if started == NO {
        let _: () = msg_send![engine, release];
        return Err(AudioError::StreamCreationFailed("Failed to start AVAudioEngine".into()));
    }
    
    MIC_ENGINE.store(engine as *mut _, Ordering::SeqCst);
    println!("[Audio] Microphone capture started");
    Ok(())
}

#[allow(deprecated)]
unsafe fn stop_microphone_capture() {
    let engine = MIC_ENGINE.swap(null_mut(), Ordering::SeqCst) as id;
    if !engine.is_null() {
        let input_node: id = msg_send![engine, inputNode];
        if !input_node.is_null() {
            let _: () = msg_send![input_node, removeTapOnBus: 0u64];
        }
        let _: () = msg_send![engine, stop];
        let _: () = msg_send![engine, release];
        println!("[Audio] Microphone capture stopped");
    }
}

// ============================================================================
// Main API
// ============================================================================

/// Start capturing system audio + microphone
/// System audio is captured via ScreenCaptureKit loopback (ALL audio output)
/// Microphone is captured via AVFoundation
#[allow(deprecated)]
pub async fn start_capture(
    _pid: i32, // No longer used - we capture all system audio
    _sr: u32,
    _ch: u32,
    output_path: &str,
    include_mic: bool,
) -> Result<AudioStreamHandle, AudioError> {
    println!("[Audio] Starting capture (system loopback + mic={}))", include_mic);

    // Clear previous data
    SYSTEM_AUDIO_DATA.lock().clear();
    MIC_AUDIO_DATA.lock().clear();
    SYSTEM_BUFFER.lock().clear();
    MIC_BUFFER.lock().clear();
    AUDIO_CHUNK_QUEUE.lock().clear();
    SYSTEM_CALLBACK_COUNT.store(0, Ordering::SeqCst);
    IS_CAPTURING.store(true, Ordering::SeqCst);
    CB_CONTENT.store(null_mut(), Ordering::SeqCst);
    CB_ERROR.store(false, Ordering::SeqCst);

    let path = output_path.to_string();
    let capture_mic = include_mic;

    // Run capture setup
    let result = tokio::task::spawn_blocking(move || unsafe { 
        // Start ScreenCaptureKit for system audio (loopback - all audio)
        setup_system_audio_capture()?;
        
        // Start microphone capture if requested
        if capture_mic {
            if let Err(e) = start_microphone_capture() {
                eprintln!("[Audio] Warning: Failed to start mic capture: {}", e);
                // Continue anyway - we'll still capture system audio
            }
        }
        
        Ok::<(), AudioError>(())
    }).await;

    match result {
        Ok(Ok(())) => {
            println!("[Audio] Capture started successfully");
            Ok(AudioStreamHandle { output_path: path })
        }
        Ok(Err(e)) => {
            IS_CAPTURING.store(false, Ordering::SeqCst);
            Err(e)
        }
        Err(e) => {
            IS_CAPTURING.store(false, Ordering::SeqCst);
            Err(AudioError::StreamCreationFailed(format!("Task error: {}", e)))
        }
    }
}

/// Setup ScreenCaptureKit to capture ALL system audio (loopback)
#[allow(deprecated)]
unsafe fn setup_system_audio_capture() -> Result<(), AudioError> {
    let sem = dispatch_semaphore_create(0);
    
    println!("[Audio] Getting shareable content for system audio...");

    let sem_ptr = sem as usize;
    let block1 = block::ConcreteBlock::new(move |content: id, error: id| {
        if error.is_null() && !content.is_null() {
            let _: () = msg_send![content, retain];
            CB_CONTENT.store(content as *mut _, Ordering::SeqCst);
        } else {
            CB_ERROR.store(true, Ordering::SeqCst);
        }
        dispatch_semaphore_signal(sem_ptr as *mut c_void);
    });
    let block1 = block1.copy();

    let _: () = msg_send![
        class!(SCShareableContent),
        getShareableContentWithCompletionHandler: &*block1
    ];

    let timeout = dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC);
    let result = dispatch_semaphore_wait(sem, timeout);
    
    if result != 0 {
        return Err(AudioError::StreamCreationFailed("Timeout".into()));
    }

    if CB_ERROR.load(Ordering::SeqCst) {
        return Err(AudioError::PermissionDenied);
    }

    let content = CB_CONTENT.load(Ordering::SeqCst) as id;
    if content.is_null() {
        return Err(AudioError::PermissionDenied);
    }

    // Get display
    let displays: id = msg_send![content, displays];
    let dcount: usize = msg_send![displays, count];
    if dcount == 0 {
        return Err(AudioError::StreamCreationFailed("No display".into()));
    }
    let display: id = msg_send![displays, objectAtIndex: 0usize];

    // Create filter to capture ALL applications (system audio loopback)
    println!("[Audio] Setting up system audio loopback (all applications)");
    let all_apps: id = msg_send![content, applications];
    let filter: id = msg_send![class!(SCContentFilter), alloc];
    let empty_windows: id = msg_send![class!(NSArray), array];
    let filter: id = msg_send![filter, initWithDisplay:display includingApplications:all_apps exceptingWindows:empty_windows];

    // Config - audio only, minimal video
    let cfg: id = msg_send![class!(SCStreamConfiguration), new];
    let _: () = msg_send![cfg, setCapturesAudio: YES];
    let _: () = msg_send![cfg, setExcludesCurrentProcessAudio: YES]; // Don't capture our own app
    let _: () = msg_send![cfg, setSampleRate: 48000i64];
    let _: () = msg_send![cfg, setChannelCount: 2i64];
    let _: () = msg_send![cfg, setWidth: 2usize];  // Minimal video
    let _: () = msg_send![cfg, setHeight: 2usize];
    let _: () = msg_send![cfg, setShowsCursor: NO];

    // Create stream
    let stream: id = msg_send![class!(SCStream), alloc];
    let stream: id = msg_send![stream, initWithFilter:filter configuration:cfg delegate:nil];
    if stream.is_null() {
        return Err(AudioError::StreamCreationFailed("Stream failed".into()));
    }

    // Add audio output
    let del: id = msg_send![get_delegate_class(), new];
    let q: id = dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);

    let mut err: id = nil;
    let ok: BOOL = msg_send![stream, addStreamOutput:del type:1i64 sampleHandlerQueue:q error:&mut err];
    if ok == NO {
        return Err(AudioError::StreamCreationFailed("Output failed".into()));
    }

    // Start capture
    let sem2 = dispatch_semaphore_create(0);
    CB_START_OK.store(false, Ordering::SeqCst);
    
    let sem2_ptr = sem2 as usize;
    let block2 = block::ConcreteBlock::new(move |error: id| {
        CB_START_OK.store(error.is_null(), Ordering::SeqCst);
        dispatch_semaphore_signal(sem2_ptr as *mut c_void);
    });
    let block2 = block2.copy();

    let _: () = msg_send![stream, startCaptureWithCompletionHandler: &*block2];
    dispatch_semaphore_wait(sem2, DISPATCH_TIME_FOREVER);

    if !CB_START_OK.load(Ordering::SeqCst) {
        return Err(AudioError::StreamCreationFailed("Start failed".into()));
    }

    ACTIVE_STREAM.store(stream as *mut _, Ordering::SeqCst);
    ACTIVE_DELEGATE.store(del as *mut _, Ordering::SeqCst);

    println!("[Audio] System audio capture started (loopback mode)");
    Ok(())
}

#[allow(deprecated)]
pub async fn stop_capture(handle: AudioStreamHandle) -> Result<(), AudioError> {
    println!("[Audio] Stopping capture");
    IS_CAPTURING.store(false, Ordering::SeqCst);

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    // Stop microphone
    unsafe { stop_microphone_capture(); }

    // Stop SCK
    unsafe {
        let stream = ACTIVE_STREAM.swap(null_mut(), Ordering::SeqCst) as id;
        let del = ACTIVE_DELEGATE.swap(null_mut(), Ordering::SeqCst) as id;

        if !stream.is_null() {
            let sem = dispatch_semaphore_create(0);
            let sem_ptr = sem as usize;
            let block = block::ConcreteBlock::new(move |_: id| {
                dispatch_semaphore_signal(sem_ptr as *mut c_void);
            });
            let block = block.copy();
            let _: () = msg_send![stream, stopCaptureWithCompletionHandler: &*block];
            dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
            let _: () = msg_send![stream, release];
        }
        if !del.is_null() {
            let _: () = msg_send![del, release];
        }
    }

    // Build any remaining stereo chunks
    build_stereo_chunks();

    // Get audio data for WAV file
    let system_data = std::mem::take(&mut *SYSTEM_AUDIO_DATA.lock());
    let mic_data = std::mem::take(&mut *MIC_AUDIO_DATA.lock());
    let rate = SAMPLE_RATE.load(Ordering::SeqCst) as u32;
    let channels = CHANNELS.load(Ordering::SeqCst) as u16;

    println!("[Audio] System audio: {} bytes, Mic audio: {} bytes", system_data.len(), mic_data.len());

    // Mix audio and save as WAV (stereo: L=system, R=mic)
    let stereo = create_stereo_wav(&system_data, &mic_data, channels);
    println!("[Audio] Stereo WAV: {} samples", stereo.len() / 4); // 2 bytes * 2 channels
    
    write_wav(&handle.output_path, &stereo, rate, 2)?; // Always stereo output
    Ok(())
}

/// Create stereo WAV data: Left = system audio, Right = mic audio
fn create_stereo_wav(system_data: &[u8], mic_data: &[u8], system_channels: u16) -> Vec<u8> {
    // Convert system audio from float32 to samples
    let system_samples: Vec<f32> = system_data
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    
    // Mix system stereo to mono if needed
    let system_mono: Vec<f32> = if system_channels == 2 {
        system_samples.chunks(2)
            .map(|pair| (pair[0] + pair.get(1).unwrap_or(&0.0)) / 2.0)
            .collect()
    } else {
        system_samples
    };
    
    // Convert mic audio from float32 to samples (already mono)
    let mic_samples: Vec<f32> = mic_data
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    
    let max_len = system_mono.len().max(mic_samples.len());
    
    // Create interleaved stereo: [L0, R0, L1, R1, ...]
    let mut stereo: Vec<u8> = Vec::with_capacity(max_len * 4); // 2 bytes * 2 channels
    
    for i in 0..max_len {
        // Left = System
        let left = system_mono.get(i).copied().unwrap_or(0.0);
        let left_i16 = (left.clamp(-1.0, 1.0) * 32767.0) as i16;
        stereo.extend_from_slice(&left_i16.to_le_bytes());
        
        // Right = Mic (boosted)
        let right = mic_samples.get(i).copied().unwrap_or(0.0) * 1.5;
        let right_i16 = (right.clamp(-1.0, 1.0) * 32767.0) as i16;
        stereo.extend_from_slice(&right_i16.to_le_bytes());
    }
    
    stereo
}

fn write_wav(path: &str, pcm: &[u8], rate: u32, channels: u16) -> Result<(), AudioError> {
    let mut f = File::create(path).map_err(|e| AudioError::WriteError(e.to_string()))?;
    f.write_all(&WavHeader::new(rate, channels, 16).write_header(pcm.len() as u32))
        .map_err(|e| AudioError::WriteError(e.to_string()))?;
    f.write_all(pcm)
        .map_err(|e| AudioError::WriteError(e.to_string()))?;
    println!("[Audio] Wrote stereo WAV: {} ({} bytes)", path, pcm.len());
    Ok(())
}
