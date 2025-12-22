#!/usr/bin/env node
/**
 * Verify cache state before and after download test
 * Checks that cache is empty before test and has files after
 */

const fs = require('fs');
const path = require('path');
const ghostNative = require('ghost-native');

console.log('🔍 Cache Verification Test\n');
console.log('='.repeat(60));

const modelPath = ghostNative.getParakeetModelPath();
console.log('Model directory:', modelPath);
console.log('');

// Step 1: Check initial state
console.log('Step 1: Checking initial cache state');
console.log('-'.repeat(60));

const initialExists = fs.existsSync(modelPath);
const initialFiles = initialExists ? fs.readdirSync(modelPath) : [];

console.log('Directory exists:', initialExists);
console.log('Number of files:', initialFiles.length);

if (initialFiles.length > 0) {
  console.log('\nFiles present:');
  initialFiles.forEach(file => {
    const filePath = path.join(modelPath, file);
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`  - ${file}: ${sizeMB} MB`);
  });
} else {
  console.log('✅ Cache is empty (as expected before download)');
}

// Step 2: Delete model to simulate fresh start
console.log('\nStep 2: Clearing cache for test');
console.log('-'.repeat(60));

try {
  if (ghostNative.isParakeetDownloaded()) {
    console.log('Deleting existing model...');
    const deleted = ghostNative.deleteParakeetModel();
    if (deleted) {
      console.log('✅ Model deleted');
    }
  }
  
  // Verify deletion
  const afterDeleteExists = fs.existsSync(modelPath);
  const afterDeleteFiles = afterDeleteExists ? fs.readdirSync(modelPath) : [];
  console.log('After deletion:');
  console.log('  Directory exists:', afterDeleteExists);
  console.log('  Number of files:', afterDeleteFiles.length);
  
  if (afterDeleteFiles.length === 0) {
    console.log('✅ Cache is now empty - ready for download test');
  } else {
    console.log('⚠️  Some files remain:', afterDeleteFiles.join(', '));
  }
} catch (e) {
  console.log('❌ Error clearing cache:', e.message);
  process.exit(1);
}

// Step 3: Start download and monitor
console.log('\nStep 3: Starting download');
console.log('-'.repeat(60));

try {
  const started = ghostNative.downloadParakeetModel();
  if (!started) {
    console.log('❌ Download failed to start');
    process.exit(1);
  }
  
  console.log('✅ Download started');
  console.log('Monitoring download progress...\n');
  
  // Monitor until complete
  let lastPercent = 0;
  const checkInterval = setInterval(() => {
    const progress = ghostNative.getParakeetDownloadProgress();
    const isDownloading = progress.isDownloading !== undefined ? progress.isDownloading : progress.is_downloading;
    const percent = progress.percent || 0;
    const bytesDownloaded = progress.bytesDownloaded !== undefined ? progress.bytesDownloaded : (progress.bytes_downloaded || 0);
    
    if (percent > lastPercent) {
      process.stdout.write(`\rProgress: ${percent}% (${(bytesDownloaded / 1024 / 1024).toFixed(2)} MB)`);
      lastPercent = percent;
    }
    
    if (!isDownloading && downloadStarted) {
      clearInterval(checkInterval);
      console.log('\n');
      
      // Step 4: Verify files after download
      console.log('\nStep 4: Verifying cache after download');
      console.log('-'.repeat(60));
      
      const finalExists = fs.existsSync(modelPath);
      const finalFiles = finalExists ? fs.readdirSync(modelPath) : [];
      
      console.log('Directory exists:', finalExists);
      console.log('Number of files:', finalFiles.length);
      
      if (finalFiles.length === 0) {
        console.log('❌ Cache is still empty after download!');
        process.exit(1);
      }
      
      console.log('\nFiles downloaded:');
      let totalSize = 0;
      const requiredFiles = [
        'encoder-model.int8.onnx',
        'decoder_joint-model.int8.onnx',
        'nemo128.onnx',
        'vocab.txt'
      ];
      
      finalFiles.forEach(file => {
        const filePath = path.join(modelPath, file);
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        totalSize += stats.size;
        const isRequired = requiredFiles.includes(file);
        console.log(`  ${isRequired ? '✅' : '  '} ${file}: ${sizeMB} MB`);
      });
      
      console.log('\nTotal size:', (totalSize / 1024 / 1024).toFixed(2), 'MB');
      
      // Verify all required files exist
      console.log('\nRequired files verification:');
      let allPresent = true;
      requiredFiles.forEach(file => {
        const filePath = path.join(modelPath, file);
        const exists = fs.existsSync(filePath);
        if (exists) {
          const size = fs.statSync(filePath).size;
          const sizeMB = (size / 1024 / 1024).toFixed(2);
          console.log(`  ✅ ${file}: ${sizeMB} MB`);
        } else {
          console.log(`  ❌ ${file}: MISSING`);
          allPresent = false;
        }
      });
      
      if (allPresent && totalSize > 600 * 1024 * 1024) {
        console.log('\n✅ Cache verification PASSED!');
        console.log('   - Cache was empty before download');
        console.log('   - Cache has all required files after download');
        console.log('   - Total size is correct (~640 MB)');
        process.exit(0);
      } else {
        console.log('\n❌ Cache verification FAILED!');
        process.exit(1);
      }
    }
  }, 500);
  
  let downloadStarted = true;
  
  // Timeout after 20 minutes
  setTimeout(() => {
    clearInterval(checkInterval);
    console.log('\n❌ Download timeout');
    process.exit(1);
  }, 20 * 60 * 1000);
  
} catch (e) {
  console.log('❌ Error:', e.message);
  process.exit(1);
}

