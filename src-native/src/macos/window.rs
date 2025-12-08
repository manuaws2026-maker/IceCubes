//! macOS window enumeration using CoreGraphics

use crate::WindowInfo;
use core_foundation::array::CFArray;
use core_foundation::base::{CFType, TCFType, CFTypeRef};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::display::{CGWindowListCopyWindowInfo, kCGWindowListOptionOnScreenOnly, kCGNullWindowID};

/// Get all visible windows on macOS
pub fn get_windows() -> Vec<WindowInfo> {
    let mut windows = Vec::new();
    
    unsafe {
        // Get window list from CGWindowListCopyWindowInfo
        let window_list = CGWindowListCopyWindowInfo(
            kCGWindowListOptionOnScreenOnly,
            kCGNullWindowID,
        );
        
        if window_list.is_null() {
            return windows;
        }
        
        let array: CFArray<CFDictionary<CFString, CFType>> = CFArray::wrap_under_get_rule(window_list as *const _);
        
        for i in 0..array.len() {
            if let Some(dict) = array.get(i) {
                if let Some(info) = parse_window_dict(&dict) {
                    // Filter out desktop elements and menu bar
                    if !info.owner_name.is_empty() && info.window_id > 0 {
                        windows.push(info);
                    }
                }
            }
        }
    }
    
    windows
}

fn parse_window_dict(dict: &CFDictionary<CFString, CFType>) -> Option<WindowInfo> {
    let key_pid = CFString::new("kCGWindowOwnerPID");
    let key_window_id = CFString::new("kCGWindowNumber");
    let key_owner_name = CFString::new("kCGWindowOwnerName");
    let key_name = CFString::new("kCGWindowName");
    let key_layer = CFString::new("kCGWindowLayer");
    let key_on_screen = CFString::new("kCGWindowIsOnscreen");
    
    // Check if window is on screen
    if let Some(on_screen_val) = dict.find(&key_on_screen) {
        let on_screen_ref = on_screen_val.as_CFTypeRef();
        let on_screen: CFBoolean = unsafe { CFBoolean::wrap_under_get_rule(on_screen_ref as *const _) };
        let is_on_screen: bool = on_screen.into();
        if !is_on_screen {
            return None;
        }
    }
    
    // Get layer - allow layer 0 (normal windows) and layer 3 (PiP/overlays)
    // Skip layer < 0 (system UI) and layer > 10 (desktop elements)
    if let Some(layer_val) = dict.find(&key_layer) {
        let layer_ref = layer_val.as_CFTypeRef();
        let layer: CFNumber = unsafe { CFNumber::wrap_under_get_rule(layer_ref as *const _) };
        if let Some(l) = layer.to_i32() {
            if l < 0 || l > 10 {
                return None;
            }
        }
    }
    
    let pid = dict.find(&key_pid).and_then(|v| {
        let num_ref = v.as_CFTypeRef();
        let num: CFNumber = unsafe { CFNumber::wrap_under_get_rule(num_ref as *const _) };
        num.to_i32()
    })?;
    
    let window_id = dict.find(&key_window_id).and_then(|v| {
        let num_ref = v.as_CFTypeRef();
        let num: CFNumber = unsafe { CFNumber::wrap_under_get_rule(num_ref as *const _) };
        num.to_i32()
    })?;
    
    let owner_name = dict.find(&key_owner_name).map(|v| {
        let str_ref = v.as_CFTypeRef();
        let s: CFString = unsafe { CFString::wrap_under_get_rule(str_ref as *const _) };
        s.to_string()
    }).unwrap_or_default();
    
    let title = dict.find(&key_name).map(|v| {
        let str_ref = v.as_CFTypeRef();
        let s: CFString = unsafe { CFString::wrap_under_get_rule(str_ref as *const _) };
        s.to_string()
    }).unwrap_or_default();
    
    // Get bundle ID from running application
    let bundle_id = get_bundle_id_for_pid(pid);
    
    Some(WindowInfo {
        pid,
        window_id,
        owner_name,
        title,
        bundle_id,
    })
}

/// Get bundle identifier for a process ID using NSWorkspace
#[allow(deprecated)]
fn get_bundle_id_for_pid(pid: i32) -> Option<String> {
    use cocoa::base::{id, nil};
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CStr;
    
    unsafe {
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        let running_apps: id = msg_send![workspace, runningApplications];
        let count: usize = msg_send![running_apps, count];
        
        for i in 0..count {
            let app: id = msg_send![running_apps, objectAtIndex: i];
            let app_pid: i32 = msg_send![app, processIdentifier];
            
            if app_pid == pid {
                let bundle_id: id = msg_send![app, bundleIdentifier];
                if bundle_id != nil {
                    let c_str: *const i8 = msg_send![bundle_id, UTF8String];
                    if !c_str.is_null() {
                        return Some(CStr::from_ptr(c_str).to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    
    None
}
