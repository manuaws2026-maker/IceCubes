#![allow(unused_imports)]
#![allow(dead_code)]
#![allow(deprecated)]
#![allow(unexpected_cfgs)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use parking_lot::Mutex;
use std::sync::Arc;

mod window;
mod audio;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows_impl;

pub use window::*;
pub use audio::*;

/// Window information returned from native APIs
#[napi(object)]
pub struct WindowInfo {
    pub pid: i32,
    pub window_id: i32,
    pub owner_name: String,
    pub title: String,
    pub bundle_id: Option<String>,
}

/// Audio capture configuration
#[napi(object)]
pub struct AudioCaptureOptions {
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub output_path: Option<String>,
    pub include_microphone: Option<bool>,
}

// Global state for audio capture
static AUDIO_ENGINE: Mutex<Option<AudioCaptureState>> = Mutex::new(None);

struct AudioCaptureState {
    is_capturing: bool,
    start_time: std::time::Instant,
    output_path: String,
    #[cfg(target_os = "macos")]
    stream_handle: Option<macos::audio::AudioStreamHandle>,
}

/// Get all visible windows on the system
#[napi]
pub fn get_active_windows() -> Vec<WindowInfo> {
    #[cfg(target_os = "macos")]
    {
        macos::window::get_windows()
    }
    
    #[cfg(target_os = "windows")]
    {
        windows_impl::window::get_windows()
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        vec![]
    }
}

/// Check if accessibility permissions are granted (macOS)
#[napi]
pub fn check_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::permissions::check_accessibility()
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Request accessibility permissions (macOS) - opens System Settings
#[napi]
pub fn request_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::permissions::request_accessibility()
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Check if screen recording permission is granted (macOS)
#[napi]
pub fn check_screen_recording_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::permissions::check_screen_recording()
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Request screen recording permission (macOS) - prompts user if not granted
#[napi]
pub fn request_screen_recording_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::permissions::request_screen_recording()
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Trigger ScreenCaptureKit to add app to Screen Recording permissions list
/// This ensures the app appears in System Settings for the user to enable
#[napi]
pub fn trigger_screen_recording_prompt() {
    #[cfg(target_os = "macos")]
    {
        macos::permissions::trigger_screen_capture_kit_permission();
    }
}

/// Get the URL from a browser window (requires accessibility permission)
#[napi]
pub fn get_browser_url(pid: i32) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        macos::accessibility::get_browser_url(pid)
    }
    
    #[cfg(target_os = "windows")]
    {
        windows_impl::accessibility::get_browser_url(pid)
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = pid;
        None
    }
}

/// Start capturing audio from a specific process
#[napi]
pub async fn start_audio_capture(pid: i32, options: Option<AudioCaptureOptions>) -> Result<()> {
    let opts = options.unwrap_or(AudioCaptureOptions {
        sample_rate: Some(48000),
        channels: Some(2),
        output_path: None,
        include_microphone: Some(true),
    });
    
    let output_path = opts.output_path.unwrap_or_else(|| {
        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        format!("/tmp/ghost_recording_{}.wav", timestamp)
    });
    
    // Check if already capturing
    {
        let state = AUDIO_ENGINE.lock();
        if state.is_some() && state.as_ref().unwrap().is_capturing {
            return Err(Error::from_reason("Already capturing audio"));
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        let stream_handle = macos::audio::start_capture(
            pid,
            opts.sample_rate.unwrap_or(48000),
            opts.channels.unwrap_or(2),
            &output_path,
            opts.include_microphone.unwrap_or(true),
        ).await.map_err(|e| Error::from_reason(format!("Failed to start capture: {}", e)))?;
        
        let mut state = AUDIO_ENGINE.lock();
        *state = Some(AudioCaptureState {
            is_capturing: true,
            start_time: std::time::Instant::now(),
            output_path,
            stream_handle: Some(stream_handle),
        });
    }
    
    #[cfg(target_os = "windows")]
    {
        windows_impl::audio::start_capture(
            pid,
            opts.sample_rate.unwrap_or(48000),
            opts.channels.unwrap_or(2),
            &output_path,
            opts.include_microphone.unwrap_or(true),
        ).map_err(|e| Error::from_reason(format!("Failed to start capture: {}", e)))?;
        
        let mut state = AUDIO_ENGINE.lock();
        *state = Some(AudioCaptureState {
            is_capturing: true,
            start_time: std::time::Instant::now(),
            output_path,
        });
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = pid;
        return Err(Error::from_reason("Unsupported platform"));
    }
    
    Ok(())
}

/// Stop capturing audio and return the path to the recorded file
#[napi]
pub async fn stop_audio_capture() -> Result<String> {
    let capture_state = {
        let mut state = AUDIO_ENGINE.lock();
        state.take().ok_or_else(|| {
            Error::from_reason("No active capture")
        })?
    };
    
    if !capture_state.is_capturing {
        return Err(Error::from_reason("Not capturing"));
    }
    
    #[cfg(target_os = "macos")]
    if let Some(handle) = capture_state.stream_handle {
        macos::audio::stop_capture(handle).await
            .map_err(|e| Error::from_reason(format!("Failed to stop capture: {}", e)))?;
    }
    
    #[cfg(target_os = "windows")]
    {
        windows_impl::audio::stop_capture()
            .map_err(|e| Error::from_reason(format!("Failed to stop capture: {}", e)))?;
    }
    
    Ok(capture_state.output_path)
}

/// Get current audio level (0.0 - 1.0)
#[napi]
pub fn get_audio_level() -> f64 {
    #[cfg(target_os = "macos")]
    {
        macos::audio::get_current_level()
    }
    
    #[cfg(target_os = "windows")]
    {
        windows_impl::audio::get_current_level()
    }
    
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        0.0
    }
}

/// Check if currently capturing
#[napi]
pub fn is_capturing() -> bool {
    let state = AUDIO_ENGINE.lock();
    state.as_ref().map(|s| s.is_capturing).unwrap_or(false)
}

/// Get capture duration in milliseconds
#[napi]
pub fn get_capture_duration() -> i64 {
    let state = AUDIO_ENGINE.lock();
    state.as_ref()
        .filter(|s| s.is_capturing)
        .map(|s| s.start_time.elapsed().as_millis() as i64)
        .unwrap_or(0)
}

/// Check if the microphone is currently being used by any application
/// This is the definitive way to know if a meeting is still active
#[napi]
pub fn is_microphone_in_use() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::mic_monitor::is_microphone_in_use()
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Get queued stereo audio chunks for streaming to Deepgram
/// Returns Vec of stereo 16-bit PCM chunks (interleaved L=system, R=mic)
/// Each chunk is ~100ms of audio at 16kHz
#[napi]
pub fn get_audio_chunks() -> Vec<Buffer> {
    #[cfg(target_os = "macos")]
    {
        macos::audio::get_audio_chunks()
            .into_iter()
            .map(|chunk| Buffer::from(chunk))
            .collect()
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        vec![]
    }
}

/// Check if there are audio chunks ready for streaming
#[napi]
pub fn has_audio_chunks() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::audio::has_audio_chunks()
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

