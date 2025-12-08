//! Cross-platform audio capture utilities

/// Audio capture error types
#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("Permission denied")]
    PermissionDenied,
    
    #[error("Process not found: {0}")]
    ProcessNotFound(i32),
    
    #[error("Failed to create stream: {0}")]
    StreamCreationFailed(String),
    
    #[error("Failed to write audio: {0}")]
    WriteError(String),
    
    #[error("Not capturing")]
    NotCapturing,
    
    #[error("Platform not supported")]
    UnsupportedPlatform,
}

/// WAV file header for writing audio
pub struct WavHeader {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
}

impl WavHeader {
    pub fn new(sample_rate: u32, channels: u16, bits_per_sample: u16) -> Self {
        Self {
            sample_rate,
            channels,
            bits_per_sample,
        }
    }
    
    /// Write WAV header to buffer
    pub fn write_header(&self, data_size: u32) -> Vec<u8> {
        let byte_rate = self.sample_rate * self.channels as u32 * self.bits_per_sample as u32 / 8;
        let block_align = self.channels * self.bits_per_sample / 8;
        let file_size = 36 + data_size;
        
        let mut header = Vec::with_capacity(44);
        
        // RIFF header
        header.extend_from_slice(b"RIFF");
        header.extend_from_slice(&file_size.to_le_bytes());
        header.extend_from_slice(b"WAVE");
        
        // fmt subchunk
        header.extend_from_slice(b"fmt ");
        header.extend_from_slice(&16u32.to_le_bytes()); // Subchunk1Size (16 for PCM)
        header.extend_from_slice(&1u16.to_le_bytes()); // AudioFormat (1 = PCM)
        header.extend_from_slice(&self.channels.to_le_bytes());
        header.extend_from_slice(&self.sample_rate.to_le_bytes());
        header.extend_from_slice(&byte_rate.to_le_bytes());
        header.extend_from_slice(&block_align.to_le_bytes());
        header.extend_from_slice(&self.bits_per_sample.to_le_bytes());
        
        // data subchunk
        header.extend_from_slice(b"data");
        header.extend_from_slice(&data_size.to_le_bytes());
        
        header
    }
}







