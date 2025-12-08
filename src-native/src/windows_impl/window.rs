//! Windows window enumeration using Win32 API

use crate::WindowInfo;

#[cfg(target_os = "windows")]
use windows::{
    Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM},
    Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    },
};

#[cfg(target_os = "windows")]
use std::ffi::OsString;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStringExt;

/// Get all visible windows on Windows
#[cfg(target_os = "windows")]
pub fn get_windows() -> Vec<WindowInfo> {
    let mut windows: Vec<WindowInfo> = Vec::new();
    
    unsafe {
        let _ = EnumWindows(
            Some(enum_window_callback),
            LPARAM(&mut windows as *mut Vec<WindowInfo> as isize),
        );
    }
    
    windows
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_window_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let windows = &mut *(lparam.0 as *mut Vec<WindowInfo>);
    
    // Check if window is visible
    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }
    
    // Get window title
    let mut title_buf = [0u16; 512];
    let len = GetWindowTextW(hwnd, &mut title_buf);
    if len == 0 {
        return BOOL(1);
    }
    
    let title = OsString::from_wide(&title_buf[..len as usize])
        .to_string_lossy()
        .to_string();
    
    // Skip empty titles
    if title.is_empty() {
        return BOOL(1);
    }
    
    // Get process ID
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    
    // Get process name
    let owner_name = get_process_name(pid).unwrap_or_default();
    
    windows.push(WindowInfo {
        pid: pid as i32,
        window_id: hwnd.0 as i32,
        owner_name,
        title,
        bundle_id: None, // Windows doesn't have bundle IDs
    });
    
    BOOL(1)
}

#[cfg(target_os = "windows")]
fn get_process_name(pid: u32) -> Option<String> {
    use windows::Win32::System::ProcessStatus::GetModuleBaseNameW;
    
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        
        let mut name_buf = [0u16; 260];
        let len = GetModuleBaseNameW(handle, None, &mut name_buf);
        
        if len == 0 {
            return None;
        }
        
        Some(
            OsString::from_wide(&name_buf[..len as usize])
                .to_string_lossy()
                .to_string(),
        )
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_windows() -> Vec<WindowInfo> {
    vec![]
}







