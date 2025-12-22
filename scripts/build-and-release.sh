#!/bin/bash
# Build, sign, notarize, and release to GitHub
# Usage: ./scripts/build-and-release.sh

set -e

echo "🚀 Build and Release Process"
echo "============================"
echo ""

# Check Google keys
if [ -z "$GOOGLE_CLIENT_ID" ] || [ -z "$GOOGLE_CLIENT_SECRET" ]; then
  echo "❌ Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set"
  echo "   export GOOGLE_CLIENT_ID='your-client-id'"
  echo "   export GOOGLE_CLIENT_SECRET='your-secret'"
  exit 1
fi

# Check Apple credentials
if [ -z "$APPLE_ID" ] || [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
  echo "❌ Error: Apple credentials must be set for notarization"
  echo "   export APPLE_ID='your-apple-id'"
  echo "   export APPLE_APP_SPECIFIC_PASSWORD='your-password'"
  exit 1
fi

echo "✅ Credentials verified"
echo ""

# Step 1: Set Google keys
echo "Step 1: Setting Google OAuth credentials..."
bash scripts/set-google-keys.sh
echo ""

# Step 2: Build native modules for both architectures
echo "Step 2: Building native modules for all architectures..."
npm run build:native:all
echo ""

# Step 3: Build main and renderer
echo "Step 3: Building main and renderer..."
npm run build:main
npm run build:renderer
npm run copy:assets
echo ""

# Step 4: Build DMG (signs and notarizes automatically)
echo "Step 4: Building DMG (signing and notarizing)..."
npm run dist:mac
echo ""

# Step 5: Check if DMGs were created
if [ -f "release/IceCubes-0.1.0.dmg" ] || [ -f "release/IceCubes-0.1.0-arm64.dmg" ]; then
  echo "✅ DMG(s) created successfully!"
  ls -lh release/*.dmg 2>/dev/null || true
  echo ""
  
  # Step 6: Restore google-config.ts (remove keys)
  echo "Step 5: Restoring google-config.ts (removing keys)..."
  git checkout src/main/google-config.ts
  echo "✅ Google keys removed from code"
  echo ""
  
  # Step 7: Push to GitHub
  echo "Step 6: Pushing to GitHub..."
  CURRENT_BRANCH=$(git branch --show-current)
  echo "Current branch: $CURRENT_BRANCH"
  read -p "Push to GitHub? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git push origin "$CURRENT_BRANCH"
    echo "✅ Pushed to GitHub"
  else
    echo "⏭️  Skipped GitHub push"
  fi
  echo ""
  
  echo "✅ Build and release complete!"
  echo ""
  echo "Next steps:"
  echo "1. Create GitHub release with DMG files"
  echo "2. Upload DMG files to the release"
else
  echo "❌ DMG files not found. Build may have failed."
  exit 1
fi

