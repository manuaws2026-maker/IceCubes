//! Monitor microphone usage to detect when a meeting ends
//! Uses CoreAudio to check if input device is being used

use std::os::raw::c_void;

// CoreAudio types and constants
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct AudioObjectPropertyAddress {
    pub selector: u32,
    pub scope: u32,
    pub element: u32,
}

type AudioObjectID = u32;
type OSStatus = i32;

// Audio property selectors - using FourCC codes
const AUDIO_HARDWARE_PROPERTY_DEFAULT_INPUT_DEVICE: u32 = 0x64496E20; // 'dIn '
const AUDIO_DEVICE_PROPERTY_DEVICE_IS_RUNNING: u32 = 0x676F696E; // 'goin' - device is running
const AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL: u32 = 0x676C6F62; // 'glob'
const AUDIO_OBJECT_PROPERTY_SCOPE_INPUT: u32 = 0x696E7074; // 'inpt'
const AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN: u32 = 0;
const AUDIO_OBJECT_SYSTEM_OBJECT: AudioObjectID = 1;

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyData(
        object_id: AudioObjectID,
        address: *const AudioObjectPropertyAddress,
        qualifier_data_size: u32,
        qualifier_data: *const c_void,
        data_size: *mut u32,
        data: *mut c_void,
    ) -> OSStatus;
}

/// Check if the default microphone is currently being used by any process
pub fn is_microphone_in_use() -> bool {
    unsafe {
        // Get the default input device
        let address = AudioObjectPropertyAddress {
            selector: AUDIO_HARDWARE_PROPERTY_DEFAULT_INPUT_DEVICE,
            scope: AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
            element: AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };

        let mut device_id: AudioObjectID = 0;
        let mut size = std::mem::size_of::<AudioObjectID>() as u32;

        let status = AudioObjectGetPropertyData(
            AUDIO_OBJECT_SYSTEM_OBJECT,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            &mut device_id as *mut _ as *mut c_void,
        );

        if status != 0 || device_id == 0 {
            println!("[Ghost MicMonitor] Failed to get default input device: {}", status);
            // On error, assume mic is in use to avoid false positives
            return true;
        }

        // Check if the device is running (using input scope for microphone)
        let running_address = AudioObjectPropertyAddress {
            selector: AUDIO_DEVICE_PROPERTY_DEVICE_IS_RUNNING,
            scope: AUDIO_OBJECT_PROPERTY_SCOPE_INPUT,
            element: AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };

        let mut is_running: u32 = 0;
        let mut running_size = std::mem::size_of::<u32>() as u32;

        let status = AudioObjectGetPropertyData(
            device_id,
            &running_address,
            0,
            std::ptr::null(),
            &mut running_size,
            &mut is_running as *mut _ as *mut c_void,
        );

        if status != 0 {
            println!("[Ghost MicMonitor] Failed to check if device is running: {} (0x{:08X})", status, status as u32);
            // On error, assume mic is in use to avoid false positives that stop recording
            return true;
        }

        is_running != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mic_check() {
        let in_use = is_microphone_in_use();
        println!("Microphone in use: {}", in_use);
    }
}

