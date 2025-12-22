# Building and Releasing IceCubes

## Prerequisites

1. **Apple Developer Account** with:
   - Team ID: `V3ED3574U9`
   - Apple ID credentials for notarization
   - Code signing certificate installed

2. **Google OAuth Credentials**:
   - Client ID and Client Secret from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)

## Build Process

### 1. Set Google OAuth Credentials

Before building the DMG, you need to set the Google OAuth credentials:

```bash
export GOOGLE_CLIENT_ID='your-client-id.apps.googleusercontent.com'
export GOOGLE_CLIENT_SECRET='your-client-secret'
./scripts/set-google-keys.sh
```

Or manually edit `src/main/google-config.ts` and replace the empty strings with your credentials.

### 2. Set Apple Notarization Credentials

```bash
export APPLE_ID='septembermanu@gmail.com'
export APPLE_APP_SPECIFIC_PASSWORD='your-app-specific-password'
export APPLE_TEAM_ID='V3ED3574U9'
```

### 3. Build Native Modules

Build native modules for both architectures:

```bash
npm run build:native:all
```

### 4. Build and Notarize DMG

Build the app, sign, and notarize:

```bash
npm run dist:mac
```

This will create:
- `release/IceCubes-0.1.0.dmg` (Intel)
- `release/IceCubes-0.1.0-arm64.dmg` (Apple Silicon)

Both DMGs will be signed and notarized.

### 5. Clean Up (Optional)

After building, you may want to remove the Google credentials from the code:

```bash
git checkout src/main/google-config.ts
```

## Notes

- Google OAuth credentials are hardcoded in `src/main/google-config.ts` for the DMG build
- Environment variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) take precedence if set
- The credentials are NOT committed to git (empty strings in the repo)
- Native modules are automatically unpacked from ASAR for proper loading

