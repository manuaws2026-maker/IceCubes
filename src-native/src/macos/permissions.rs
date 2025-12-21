//! macOS permission checking and requesting

use cocoa::base::{id, nil};
use core_foundation::base::TCFType;
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::runloop::{kCFRunLoopDefaultMode, CFRunLoopRunInMode};
use core_foundation::string::CFString;
use objc::{class, msg_send, sel, sel_impl};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrustedWithOptions(options: core_foundation::dictionary::CFDictionaryRef) -> bool;
}

#[link(name = "ScreenCaptureKit", kind = "framework")]
extern "C" {}

/// Check if accessibility permission is granted
pub fn check_accessibility() -> bool {
    unsafe {
        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let options = CFDictionary::from_CFType_pairs(&[(
            key.as_CFType(),
            CFBoolean::false_value().as_CFType(),
        )]);

        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef())
    }
}

/// Request accessibility permission (opens System Settings)
pub fn request_accessibility() -> bool {
    unsafe {
        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let options = CFDictionary::from_CFType_pairs(&[(
            key.as_CFType(),
            CFBoolean::true_value().as_CFType(),
        )]);

        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef())
    }
}

/// Check if screen recording permission is granted by actually querying ScreenCaptureKit
#[allow(deprecated)]
pub fn check_screen_recording() -> bool {
    // First try CG preflight (checks System Settings permission)
    let cg_check = unsafe { CGPreflightScreenCaptureAccess() };
    
    // Also verify with actual SCK call for accuracy
    let sck_check = check_screen_recording_via_sck();
    
    tracing::debug!("Screen recording check - CG: {}, SCK: {}", cg_check, sck_check);
    
    // Return true if either check passes
    // CG check is more reliable for System Settings permission
    // SCK check verifies ScreenCaptureKit actually works
    cg_check || sck_check
}

/// Actually try to get shareable content to verify permission
#[allow(deprecated)]
fn check_screen_recording_via_sck() -> bool {
    use std::sync::atomic::Ordering;
    
    SCK_DONE.store(false, Ordering::SeqCst);
    SCK_OK.store(false, Ordering::SeqCst);

    unsafe {
        let block = block::ConcreteBlock::new(move |content: id, error: id| {
            let success = error.is_null() && !content.is_null();
            SCK_OK.store(success, Ordering::SeqCst);
            SCK_DONE.store(true, Ordering::SeqCst);
        });
        let block = block.copy();

        let _: () = msg_send![
            class!(SCShareableContent),
            getShareableContentWithCompletionHandler: &*block
        ];

        // Wait for callback with short timeout
        let start = Instant::now();
        while !SCK_DONE.load(Ordering::SeqCst) {
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, 1);
            std::thread::sleep(Duration::from_millis(5));
            if start.elapsed() > Duration::from_secs(2) {
                return false;
            }
        }
        
        SCK_OK.load(Ordering::SeqCst)
    }
}

// Callback state for SCK permission check
static SCK_DONE: AtomicBool = AtomicBool::new(false);
static SCK_OK: AtomicBool = AtomicBool::new(false);

/// Request screen recording permission by triggering ScreenCaptureKit
/// This will add the app to the Screen Recording list and prompt the user
#[allow(deprecated)]
pub fn request_screen_recording() -> bool {
    // First try the basic CG request
    unsafe {
        CGRequestScreenCaptureAccess();
    }
    
    // Then trigger ScreenCaptureKit to ensure app appears in list
    trigger_screen_capture_kit_permission();
    
    check_screen_recording()
}

/// Trigger ScreenCaptureKit to add app to Screen Recording permissions list
#[allow(deprecated)]
pub fn trigger_screen_capture_kit_permission() {
    SCK_DONE.store(false, Ordering::SeqCst);
    SCK_OK.store(false, Ordering::SeqCst);

    unsafe {
        let block = block::ConcreteBlock::new(move |content: id, error: id| {
            SCK_OK.store(error.is_null() && !content.is_null(), Ordering::SeqCst);
            SCK_DONE.store(true, Ordering::SeqCst);
        });
        let block = block.copy();

        let _: () = msg_send![
            class!(SCShareableContent),
            getShareableContentWithCompletionHandler: &*block
        ];

        // Wait for callback with timeout
        let start = Instant::now();
        while !SCK_DONE.load(Ordering::SeqCst) {
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, 1);
            std::thread::sleep(Duration::from_millis(10));
            if start.elapsed() > Duration::from_secs(5) {
                break;
            }
        }
    }
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}
