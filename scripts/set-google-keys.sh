#!/bin/bash
# Script to set Google OAuth credentials before building DMG
# Usage: ./scripts/set-google-keys.sh

GOOGLE_CONFIG_FILE="src/main/google-config.ts"

if [ -z "$GOOGLE_CLIENT_ID" ] || [ -z "$GOOGLE_CLIENT_SECRET" ]; then
  echo "Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables must be set"
  echo "Usage: export GOOGLE_CLIENT_ID='your-client-id' && export GOOGLE_CLIENT_SECRET='your-secret' && ./scripts/set-google-keys.sh"
  exit 1
fi

# Create backup
cp "$GOOGLE_CONFIG_FILE" "$GOOGLE_CONFIG_FILE.bak"

# Update the file with actual credentials
cat > "$GOOGLE_CONFIG_FILE" << EOF
// Google OAuth Configuration
// These credentials are bundled into the app for Google Calendar integration
// Environment variables take precedence if set (for development/testing)
// 
// Before building DMG: Replace the empty strings below with your Google OAuth credentials
// Get credentials from: https://console.cloud.google.com/apis/credentials

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '${GOOGLE_CLIENT_ID}';
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '${GOOGLE_CLIENT_SECRET}';
EOF

echo "✅ Google OAuth credentials set in $GOOGLE_CONFIG_FILE"
echo "   Client ID: ${GOOGLE_CLIENT_ID:0:20}..."
echo "   Ready to build DMG"

