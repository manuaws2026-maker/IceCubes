# Universal Binary Setup for IceCubes

## Problem
The app was only built for `arm64` (Apple Silicon), causing "Application is not supported on this Mac" error on Intel Macs.

## Solution Implemented
Build for both architectures: `x64` (Intel) and `arm64` (Apple Silicon).

## Changes Made

### 1. package.json (Main)
- Updated `mac.target.arch` to include both `["x64", "arm64"]` for DMG and ZIP targets
- Added `build:native:all` script to build native modules for both architectures
- Updated `dist:mac` script to use multi-architecture native build

### 2. src-native/package.json
- Added `build:all` script that builds for both `x86_64-apple-darwin` and `aarch64-apple-darwin`
- Native module triples already included both architectures

### 3. Rust Targets
- Installed `x86_64-apple-darwin` target for cross-compilation from Apple Silicon

## Build Process

### For Development (Current Platform Only)
```bash
npm run build:all  # Builds for current platform only
npm run dev
```

### For Distribution (Both Architectures)
```bash
npm run dist:mac  # Builds native modules for both architectures, then builds Electron app
```

## Output
Electron Builder will create:
- `IceCubes-0.1.0-x64.dmg` - For Intel Macs
- `IceCubes-0.1.0-arm64.dmg` - For Apple Silicon Macs

Or if configured for universal binary:
- `IceCubes-0.1.0-universal.dmg` - Single DMG that works on both

## Native Module Files
- `ghost-native.darwin-arm64.node` - Apple Silicon version
- `ghost-native.node` - Intel version (x86_64)

Electron Builder automatically includes the correct native module for each architecture.

## Testing
1. Test Intel build on Intel Mac
2. Test Apple Silicon build on Apple Silicon Mac
3. Verify native modules load correctly on both

## Notes
- Cross-compilation from Apple Silicon to Intel works automatically with Rust
- Both native modules are ~76-81MB each
- Electron Builder handles architecture-specific bundling automatically


