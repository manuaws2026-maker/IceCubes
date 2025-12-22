#!/bin/bash

echo "🔧 Resetting IceCubes permissions and state for first-time testing..."

# App bundle identifier
APP_ID="ai.icecubes.app"

# 1. Reset all TCC (Transparency, Consent, and Control) permissions
echo "📋 Resetting TCC permissions..."
sudo tccutil reset All "$APP_ID" 2>/dev/null || echo "Note: Some permissions may require manual reset in System Settings"

# 2. Reset microphone permission
echo "🎤 Resetting microphone permission..."
sudo tccutil reset Microphone "$APP_ID" 2>/dev/null || echo "Note: Microphone permission may require manual reset"

# 3. Reset screen recording permission  
echo "🖥️  Resetting screen recording permission..."
sudo tccutil reset ScreenCapture "$APP_ID" 2>/dev/null || echo "Note: Screen recording permission may require manual reset"

# 4. Reset accessibility permission
echo "♿ Resetting accessibility permission..."
sudo tccutil reset Accessibility "$APP_ID" 2>/dev/null || echo "Note: Accessibility permission may require manual reset"

# 5. Clear app preferences/state
echo "🗑️  Clearing app preferences..."
rm -rf ~/Library/Application\ Support/IceCubes 2>/dev/null || true
rm -rf ~/Library/Preferences/ai.icecubes.app.plist 2>/dev/null || true
rm -rf ~/Library/Saved\ Application\ State/ai.icecubes.app.savedState 2>/dev/null || true

# 6. Clear Electron cache
echo "🧹 Clearing Electron cache..."
rm -rf ~/Library/Caches/ai.icecubes.app 2>/dev/null || true

# 7. Also reset for Electron (in case permissions were granted to Electron directly)
echo "🔄 Resetting Electron permissions..."
sudo tccutil reset All "com.github.Electron" 2>/dev/null || true
sudo tccutil reset Microphone "com.github.Electron" 2>/dev/null || true
sudo tccutil reset ScreenCapture "com.github.Electron" 2>/dev/null || true
sudo tccutil reset Accessibility "com.github.Electron" 2>/dev/null || true

echo ""
echo "✅ Reset complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Open System Settings → Privacy & Security"
echo "   2. Manually revoke any remaining permissions for 'IceCubes' or 'Electron'"
echo "   3. If the app is installed, delete it from Applications:"
echo "      rm -rf /Applications/IceCubes.app"
echo "   4. Run the DMG and install fresh"
echo ""
echo "⚠️  Note: Check System Settings manually for:"
echo "   - Microphone: System Settings → Privacy & Security → Microphone"
echo "   - Screen Recording: System Settings → Privacy & Security → Screen Recording"
echo "   - Accessibility: System Settings → Privacy & Security → Accessibility"



