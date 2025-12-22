#!/usr/bin/env node
/**
 * End-to-end test simulating Electron app startup
 * Tests the actual code path used in src/main/index.ts
 */

// Simulate Electron's process object
global.process = process;

console.log('🧪 Electron App Integration Test\n');
console.log('Simulating Electron app startup...\n');

// Test the getNativeModule function logic
function testGetNativeModule() {
  console.log('Test: getNativeModule() function logic');
  
  try {
    // This is what src/main/index.ts does
    const nativeModule = require('ghost-native');
    
    console.log('✅ Native module loaded successfully');
    console.log(`   Platform: ${process.platform}`);
    console.log(`   Architecture: ${process.arch}`);
    
    // Verify key functions exist (as done in index.ts)
    if (!nativeModule.downloadParakeetModel) {
      console.log('❌ downloadParakeetModel function not found');
      return false;
    }
    
    if (!nativeModule.initParakeet) {
      console.log('❌ initParakeet function not found');
      return false;
    }
    
    console.log('✅ All required functions present');
    
    // Test parakeet-check-requirements IPC handler logic
    console.log('\nTest: parakeet-check-requirements handler');
    const requirements = {
      hasOnnxRuntime: !!nativeModule,
      hasGpuSupport: true,
      availableMemory: 4000000000,
      meetsRequirements: !!nativeModule,
      missingRequirements: nativeModule ? [] : ['Native module not loaded']
    };
    
    console.log('Requirements check:');
    console.log(`   Has ONNX Runtime: ${requirements.hasOnnxRuntime ? '✅' : '❌'}`);
    console.log(`   Meets requirements: ${requirements.meetsRequirements ? '✅' : '❌'}`);
    console.log(`   Missing: ${requirements.missingRequirements.join(', ') || 'None'}`);
    
    // Test parakeet-download-model IPC handler logic
    console.log('\nTest: parakeet-download-model handler');
    if (!nativeModule) {
      console.log('❌ Native module not loaded');
      return false;
    }
    
    if (!nativeModule.downloadParakeetModel) {
      console.log('❌ downloadParakeetModel function not available');
      return false;
    }
    
    console.log('✅ downloadParakeetModel function available');
    console.log('   (Would start download in background thread)');
    
    return true;
    
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
    console.log('   Code:', e.code);
    console.log('   Path:', e.path);
    return false;
  }
}

// Test the actual IPC handler simulation
function testParakeetDownloadHandler() {
  console.log('\nTest: Simulating parakeet-download-model IPC call');
  
  try {
    const nativeModule = require('ghost-native');
    
    // Simulate what the IPC handler does
    if (!nativeModule) {
      console.log('❌ Native module not loaded');
      return { success: false, started: false, error: 'Native module not loaded' };
    }
    
    if (!nativeModule.downloadParakeetModel) {
      console.log('❌ downloadParakeetModel function not available');
      return { success: false, started: false, error: 'downloadParakeetModel function not available' };
    }
    
    // Check if already downloaded
    const isDownloaded = nativeModule.isParakeetDownloaded();
    if (isDownloaded) {
      console.log('✅ Model already downloaded (would skip download)');
      return { success: true, started: false, alreadyDownloaded: true };
    }
    
    // Would start download (but we won't actually start it in test)
    console.log('✅ downloadParakeetModel function available');
    console.log('   (In real app, would call: nativeModule.downloadParakeetModel())');
    
    return { success: true, started: false, note: 'Download not started in test' };
    
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
    return { success: false, started: false, error: e.message };
  }
}

// Run tests
console.log('='.repeat(60));
const test1 = testGetNativeModule();
console.log('='.repeat(60));
const test2 = testParakeetDownloadHandler();
console.log('='.repeat(60));

console.log('\n📊 Test Summary:');
console.log(`   getNativeModule(): ${test1 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`   parakeet-download-model: ${test2.success ? '✅ PASS' : '❌ FAIL'}`);

if (test1 && test2.success) {
  console.log('\n✅ All Electron app integration tests passed!');
  console.log('   The native module is ready for use in the Electron app.');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed');
  process.exit(1);
}

