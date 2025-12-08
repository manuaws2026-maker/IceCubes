//! macOS accessibility API for reading UI elements

use core_foundation::base::TCFType;
use core_foundation::string::CFString;
use std::ffi::c_void;
use std::ptr::null_mut;

type AXUIElementRef = *mut c_void;
type CFStringRef = *const c_void;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut *const c_void,
    ) -> i32;
    fn CFRelease(cf: *const c_void);
}

/// Get the URL from a browser window using accessibility APIs
pub fn get_browser_url(pid: i32) -> Option<String> {
    unsafe {
        // Create accessibility element for the application
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            return None;
        }
        
        // Get focused window
        let mut focused_window: AXUIElementRef = null_mut();
        let attr_focused = CFString::new("AXFocusedWindow");
        let result = AXUIElementCopyAttributeValue(
            app,
            attr_focused.as_concrete_TypeRef() as CFStringRef,
            &mut focused_window as *mut _ as *mut *const c_void,
        );
        
        if result != 0 || focused_window.is_null() {
            CFRelease(app as *const c_void);
            return None;
        }
        
        // Try to find URL bar by traversing the accessibility tree
        // Limit depth to 15 levels to prevent stack overflow
        let url = find_url_element(focused_window, 0, 15);
        
        CFRelease(app as *const c_void);
        if !focused_window.is_null() {
            CFRelease(focused_window as *const c_void);
        }
        
        url
    }
}

/// Navigate the accessibility tree to find URL element
/// depth: current recursion depth
/// max_depth: maximum allowed depth to prevent stack overflow
unsafe fn find_url_element(element: AXUIElementRef, depth: u32, max_depth: u32) -> Option<String> {
    // Prevent stack overflow by limiting recursion depth
    if depth >= max_depth {
        return None;
    }
    
    // Get children
    let mut children: *const c_void = null_mut() as *const c_void;
    let attr_children = CFString::new("AXChildren");
    let result = AXUIElementCopyAttributeValue(
        element,
        attr_children.as_concrete_TypeRef() as CFStringRef,
        &mut children as *mut _ as *mut *const c_void,
    );
    
    if result != 0 || children.is_null() {
        return None;
    }
    
    let children_array: core_foundation::array::CFArray<core_foundation::base::CFType> = 
        core_foundation::array::CFArray::wrap_under_get_rule(children as *const _);
    
    for i in 0..children_array.len() {
        if let Some(child) = children_array.get(i) {
            let child_element = child.as_CFTypeRef() as AXUIElementRef;
            
            // Check role
            let mut role: *const c_void = null_mut() as *const c_void;
            let attr_role = CFString::new("AXRole");
            let _ = AXUIElementCopyAttributeValue(
                child_element,
                attr_role.as_concrete_TypeRef() as CFStringRef,
                &mut role as *mut _ as *mut *const c_void,
            );
            
            if !role.is_null() {
                let role_str: CFString = CFString::wrap_under_get_rule(role as *const _);
                let role_string = role_str.to_string();
                
                // Check for text field (address bar)
                if role_string == "AXTextField" || role_string == "AXComboBox" {
                    // Check if this looks like a URL bar
                    let mut identifier: *const c_void = null_mut() as *const c_void;
                    let attr_id = CFString::new("AXIdentifier");
                    let _ = AXUIElementCopyAttributeValue(
                        child_element,
                        attr_id.as_concrete_TypeRef() as CFStringRef,
                        &mut identifier as *mut _ as *mut *const c_void,
                    );
                    
                    let is_url_bar = if !identifier.is_null() {
                        let id_str: CFString = CFString::wrap_under_get_rule(identifier as *const _);
                        let id_string = id_str.to_string().to_lowercase();
                        id_string.contains("url") || id_string.contains("address") || id_string.contains("omnibox")
                    } else {
                        // Check description as fallback
                        let mut desc: *const c_void = null_mut() as *const c_void;
                        let attr_desc = CFString::new("AXDescription");
                        let _ = AXUIElementCopyAttributeValue(
                            child_element,
                            attr_desc.as_concrete_TypeRef() as CFStringRef,
                            &mut desc as *mut _ as *mut *const c_void,
                        );
                        
                        if !desc.is_null() {
                            let desc_str: CFString = CFString::wrap_under_get_rule(desc as *const _);
                            let desc_string = desc_str.to_string().to_lowercase();
                            desc_string.contains("url") || desc_string.contains("address")
                        } else {
                            false
                        }
                    };
                    
                    if is_url_bar {
                        // Get the value (URL)
                        let mut value: *const c_void = null_mut() as *const c_void;
                        let attr_value = CFString::new("AXValue");
                        let _ = AXUIElementCopyAttributeValue(
                            child_element,
                            attr_value.as_concrete_TypeRef() as CFStringRef,
                            &mut value as *mut _ as *mut *const c_void,
                        );
                        
                        if !value.is_null() {
                            let value_str: CFString = CFString::wrap_under_get_rule(value as *const _);
                            return Some(value_str.to_string());
                        }
                    }
                }
            }
            
            // Recursively search children (increment depth)
            if let Some(url) = find_url_element(child_element, depth + 1, max_depth) {
                return Some(url);
            }
        }
    }
    
    None
}
