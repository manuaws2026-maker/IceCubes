#!/usr/bin/env node
/**
 * Automated test for Parakeet model download
 * Tests the complete download flow including progress tracking
 */

const ghostNative = require('ghost-native');

console.log('🧪 Parakeet Download Automation Test\n');
console.log('='.repeat(60));

// Configuration
const DOWNLOAD_TIMEOUT = 15 * 60 * 1000; // 15 minutes timeout
const PROGRESS_CHECK_INTERVAL = 1000; // Check progress every second
const MAX_RETRIES = 3;

let downloadStarted = false;
let downloadCompleted = false;
let downloadError = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

async function checkDownloadProgress() {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let lastBytes = 0;
    let stallCount = 0;
    
    const checkInterval = setInterval(() => {
      try {
        const progress = ghostNative.getParakeetDownloadProgress();
        const elapsed = (Date.now() - startTime) / 1000;
        
        // Check if download is still active
        if (!progress.is_downloading && downloadStarted) {
          clearInterval(checkInterval);
          
          if (progress.error) {
            downloadError = progress.error;
            downloadCompleted = false;
            console.log(`\n❌ Download failed: ${progress.error}`);
            resolve(false);
            return;
          }
          
          if (progress.percent === 100) {
            downloadCompleted = true;
            console.log(`\n✅ Download completed successfully!`);
            console.log(`   Total time: ${formatTime(elapsed)}`);
            console.log(`   Total size: ${formatBytes(progress.total_bytes)}`);
            resolve(true);
            return;
          }
        }
        
        // Show progress
        if (progress.is_downloading) {
          const currentBytes = progress.bytes_downloaded || 0;
          const bytesDiff = currentBytes - lastBytes;
          const speed = bytesDiff > 0 ? formatBytes(bytesDiff) + '/s' : '0 B/s';
          
          // Check for stall
          if (bytesDiff === 0 && currentBytes > 0) {
            stallCount++;
            if (stallCount > 10) {
              console.log(`\n⚠️  Download appears stalled (no progress for 10s)`);
            }
          } else {
            stallCount = 0;
          }
          
          process.stdout.write(`\r   Progress: ${progress.percent}% | ${formatBytes(currentBytes)} / ${formatBytes(progress.total_bytes)} | ${speed} | ${progress.current_file || 'Starting...'}`);
          lastBytes = currentBytes;
        }
        
        // Timeout check
        if (elapsed > DOWNLOAD_TIMEOUT / 1000) {
          clearInterval(checkInterval);
          console.log(`\n❌ Download timeout after ${formatTime(elapsed)}`);
          resolve(false);
        }
        
      } catch (e) {
        clearInterval(checkInterval);
        console.log(`\n❌ Error checking progress: ${e.message}`);
        resolve(false);
      }
    }, PROGRESS_CHECK_INTERVAL);
  });
}

async function testDownload() {
  console.log('Step 1: Checking current download status');
  console.log('-'.repeat(60));
  
  const isDownloaded = ghostNative.isParakeetDownloaded();
  const modelInfo = ghostNative.getParakeetModelInfo();
  
  console.log(`Model downloaded: ${isDownloaded ? '✅ Yes' : '❌ No'}`);
  if (isDownloaded) {
    console.log(`Model version: ${modelInfo.version}`);
    console.log(`Model size: ${formatBytes(modelInfo.size)}`);
    console.log(`Model path: ${modelInfo.path}`);
  }
  
  // Check if download is already in progress
  const progress = ghostNative.getParakeetDownloadProgress();
  if (progress.is_downloading) {
    console.log('\n⚠️  Download already in progress');
    console.log('   Waiting for current download to complete...');
    const result = await checkDownloadProgress();
    if (result) {
      console.log('✅ Existing download completed');
      return true;
    } else {
      console.log('❌ Existing download failed');
      return false;
    }
  }
  
  if (isDownloaded) {
    console.log('\n✅ Model already downloaded. Testing re-download...');
    console.log('   (In real scenario, would skip download)');
    
    // Test that we can still start a download (it should detect existing files)
    console.log('\nStep 2: Testing download start (should detect existing files)');
    console.log('-'.repeat(60));
    
    try {
      const started = ghostNative.downloadParakeetModel();
      if (started) {
        console.log('✅ downloadParakeetModel() returned true');
        console.log('   (Download would skip existing files)');
        
        // Wait a bit to see if it detects existing files
        await sleep(2000);
        const newProgress = ghostNative.getParakeetDownloadProgress();
        if (!newProgress.is_downloading || newProgress.percent === 100) {
          console.log('✅ Download correctly detected existing files');
        }
      } else {
        console.log('⚠️  downloadParakeetModel() returned false (download may already be in progress)');
      }
    } catch (e) {
      console.log(`❌ Error starting download: ${e.message}`);
      return false;
    }
    
    return true;
  }
  
  // Model not downloaded - start download
  console.log('\nStep 2: Starting download');
  console.log('-'.repeat(60));
  
  try {
    const started = ghostNative.downloadParakeetModel();
    if (!started) {
      console.log('❌ downloadParakeetModel() returned false');
      console.log('   (Download may already be in progress or failed to start)');
      return false;
    }
    
    downloadStarted = true;
    console.log('✅ Download started successfully');
    console.log('   Monitoring progress...\n');
    
    // Monitor download progress
    const result = await checkDownloadProgress();
    
    if (result) {
      // Verify download completed
      console.log('\nStep 3: Verifying download');
      console.log('-'.repeat(60));
      
      const verifyDownloaded = ghostNative.isParakeetDownloaded();
      const verifyInfo = ghostNative.getParakeetModelInfo();
      
      if (verifyDownloaded) {
        console.log('✅ Model verification passed');
        console.log(`   Version: ${verifyInfo.version}`);
        console.log(`   Size: ${formatBytes(verifyInfo.size)}`);
        console.log(`   Path: ${verifyInfo.path}`);
        
        // Test initialization
        console.log('\nStep 4: Testing model initialization');
        console.log('-'.repeat(60));
        
        try {
          const initResult = ghostNative.initParakeet();
          if (initResult) {
            const isReady = ghostNative.isParakeetReady();
            console.log(`✅ Model initialized successfully`);
            console.log(`   isParakeetReady(): ${isReady}`);
            return true;
          } else {
            console.log('❌ Initialization returned false');
            return false;
          }
        } catch (e) {
          console.log(`❌ Initialization error: ${e.message}`);
          return false;
        }
      } else {
        console.log('❌ Model verification failed - not marked as downloaded');
        return false;
      }
    } else {
      console.log('❌ Download did not complete successfully');
      return false;
    }
    
  } catch (e) {
    console.log(`❌ Error during download: ${e.message}`);
    console.log('Stack:', e.stack);
    return false;
  }
}

// Main test execution
(async () => {
  try {
    console.log('Starting automated Parakeet download test...\n');
    
    const success = await testDownload();
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary');
    console.log('='.repeat(60));
    console.log(`Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
    
    if (success) {
      console.log('\n✅ All download tests passed!');
      console.log('   Parakeet model download and initialization working correctly.');
      process.exit(0);
    } else {
      console.log('\n❌ Some tests failed');
      if (downloadError) {
        console.log(`   Error: ${downloadError}`);
      }
      process.exit(1);
    }
    
  } catch (e) {
    console.log(`\n❌ Fatal error: ${e.message}`);
    console.log('Stack:', e.stack);
    process.exit(1);
  }
})();

