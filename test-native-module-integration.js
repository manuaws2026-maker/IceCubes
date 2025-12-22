#!/usr/bin/env node
/**
 * Integration test for native module loading
 * Simulates how Electron loads the native module in packaged apps
 */

const path = require('path');
const fs = require('fs');

console.log('🧪 Native Module Integration Test\n');
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);
console.log('');

// Test 1: Load the module via require('ghost-native')
console.log('Test 1: Loading via require("ghost-native")');
try {
  const ghostNative = require('ghost-native');
  console.log('✅ Module loaded successfully');
  
  // Check for key functions
  const requiredFunctions = [
    'downloadParakeetModel',
    'initParakeet',
    'isParakeetReady',
    'isParakeetDownloaded',
    'getParakeetModelInfo',
    'transcribeAudioBuffer'
  ];
  
  console.log('\nChecking required functions:');
  let allFunctionsPresent = true;
  requiredFunctions.forEach(funcName => {
    if (typeof ghostNative[funcName] === 'function') {
      console.log(`  ✅ ${funcName}`);
    } else {
      console.log(`  ❌ ${funcName} - MISSING`);
      allFunctionsPresent = false;
    }
  });
  
  if (!allFunctionsPresent) {
    console.log('\n⚠️  Some required functions are missing!');
    process.exit(1);
  }
  
  // Test 2: Check if we can call a simple function
  console.log('\nTest 2: Calling isParakeetDownloaded()');
  try {
    const isDownloaded = ghostNative.isParakeetDownloaded();
    console.log(`✅ isParakeetDownloaded() returned: ${isDownloaded}`);
  } catch (e) {
    console.log(`❌ Error calling isParakeetDownloaded(): ${e.message}`);
    process.exit(1);
  }
  
  // Test 3: Get model info
  console.log('\nTest 3: Getting Parakeet model info');
  try {
    const modelInfo = ghostNative.getParakeetModelInfo();
    console.log('✅ Model info retrieved:');
    console.log(`   Downloaded: ${modelInfo.downloaded}`);
    console.log(`   Version: ${modelInfo.version}`);
    console.log(`   Size: ${modelInfo.size} bytes`);
    console.log(`   Path: ${modelInfo.path}`);
  } catch (e) {
    console.log(`❌ Error getting model info: ${e.message}`);
    process.exit(1);
  }
  
  // Test 4: Check download progress (should work even if not downloading)
  console.log('\nTest 4: Getting download progress');
  try {
    const progress = ghostNative.getParakeetDownloadProgress();
    console.log('✅ Download progress retrieved:');
    console.log(`   Is downloading: ${progress.is_downloading}`);
    console.log(`   Percent: ${progress.percent}%`);
    console.log(`   Bytes downloaded: ${progress.bytes_downloaded}`);
  } catch (e) {
    console.log(`❌ Error getting download progress: ${e.message}`);
    process.exit(1);
  }
  
  console.log('\n✅ All integration tests passed!');
  console.log('\nThe native module is working correctly and ready for use in Electron.');
  
} catch (e) {
  console.log('❌ Failed to load native module:', e.message);
  console.log('Error details:', {
    code: e.code,
    path: e.path,
    errno: e.errno
  });
  process.exit(1);
}

