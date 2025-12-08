//! Cross-platform window enumeration utilities

use crate::WindowInfo;

/// Trait for platform-specific window enumeration
pub trait WindowEnumerator {
    fn enumerate() -> Vec<WindowInfo>;
}







