#!/usr/bin/env node
/**
 * Integration test for Parakeet functionality
 * Tests the actual Parakeet download and initialization flow
 */

const ghostNative = require('ghost-native');

console.log('🧪 Parakeet Integration Test\n');

async function testParakeet() {
  try {
    // Test 1: Check if model is downloaded
    console.log('Test 1: Checking if Parakeet model is downloaded');
    const isDownloaded = ghostNative.isParakeetDownloaded();
    console.log(`Result: ${isDownloaded ? '✅ Downloaded' : '❌ Not downloaded'}`);
    
    // Test 2: Get model info
    console.log('\nTest 2: Getting model information');
    const modelInfo = ghostNative.getParakeetModelInfo();
    console.log('Model Info:');
    console.log(`  Downloaded: ${modelInfo.downloaded}`);
    console.log(`  Version: ${modelInfo.version}`);
    console.log(`  Size: ${(modelInfo.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Path: ${modelInfo.path}`);
    
    // Test 3: Get languages
    console.log('\nTest 3: Getting supported languages');
    const languages = ghostNative.getParakeetLanguages();
    console.log(`✅ Supported ${languages.length} languages`);
    console.log(`   Sample: ${languages.slice(0, 5).join(', ')}...`);
    
    // Test 4: Check initialization status
    console.log('\nTest 4: Checking initialization status');
    const isReady = ghostNative.isParakeetReady();
    console.log(`Ready: ${isReady ? '✅ Yes' : '❌ No (not initialized)'}`);
    
    // Test 5: Get download progress (should work even if not downloading)
    console.log('\nTest 5: Getting download progress');
    const progress = ghostNative.getParakeetDownloadProgress();
    console.log('Progress Info:');
    console.log(`  Is downloading: ${progress.is_downloading}`);
    console.log(`  Current file: ${progress.current_file || 'N/A'}`);
    console.log(`  Progress: ${progress.percent}%`);
    console.log(`  Bytes: ${(progress.bytes_downloaded / 1024 / 1024).toFixed(2)} MB / ${(progress.total_bytes / 1024 / 1024).toFixed(2)} MB`);
    
    if (!isDownloaded) {
      console.log('\n⚠️  Model not downloaded. To test download:');
      console.log('   const started = ghostNative.downloadParakeetModel();');
      console.log('   // Then poll progress with getParakeetDownloadProgress()');
    } else {
      console.log('\n✅ Model is downloaded. Testing initialization...');
      
      // Test 6: Try to initialize (if downloaded)
      try {
        console.log('\nTest 6: Initializing Parakeet model');
        const initResult = ghostNative.initParakeet();
        if (initResult) {
          console.log('✅ Model initialized successfully');
          
          const ready = ghostNative.isParakeetReady();
          console.log(`✅ isParakeetReady() returns: ${ready}`);
        } else {
          console.log('❌ Initialization returned false');
        }
      } catch (e) {
        console.log(`⚠️  Initialization error (may be expected): ${e.message}`);
      }
    }
    
    console.log('\n✅ All Parakeet integration tests completed!');
    
  } catch (e) {
    console.log(`❌ Error during testing: ${e.message}`);
    console.log('Stack:', e.stack);
    process.exit(1);
  }
}

testParakeet();

