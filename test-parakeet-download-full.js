#!/usr/bin/env node
/**
 * Full automated test for Parakeet model download
 * Can optionally delete existing model to test full download flow
 * Usage: 
 *   node test-parakeet-download-full.js           # Test with existing model
 *   node test-parakeet-download-full.js --fresh   # Delete and re-download
 */

const ghostNative = require('ghost-native');
const fs = require('fs');
const path = require('path');

const FRESH_DOWNLOAD = process.argv.includes('--fresh');

console.log('🧪 Parakeet Full Download Automation Test\n');
if (FRESH_DOWNLOAD) {
  console.log('⚠️  FRESH DOWNLOAD MODE: Will delete existing model\n');
}
console.log('='.repeat(60));

const DOWNLOAD_TIMEOUT = 20 * 60 * 1000; // 20 minutes
const PROGRESS_CHECK_INTERVAL = 500; // Check every 500ms for smoother updates

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

async function deleteModel() {
  console.log('Step 0: Deleting existing model');
  console.log('-'.repeat(60));
  
  try {
    const modelInfo = ghostNative.getParakeetModelInfo();
    const modelPath = modelInfo.path;
    
    if (fs.existsSync(modelPath)) {
      console.log(`Deleting model directory: ${modelPath}`);
      fs.rmSync(modelPath, { recursive: true, force: true });
      console.log('✅ Model deleted');
      
      // Verify deletion
      await sleep(1000);
      const isDownloaded = ghostNative.isParakeetDownloaded();
      if (!isDownloaded) {
        console.log('✅ Verified: Model is no longer marked as downloaded');
        return true;
      } else {
        console.log('⚠️  Model still marked as downloaded (may be cached)');
        return true; // Continue anyway
      }
    } else {
      console.log('⚠️  Model directory does not exist');
      return true;
    }
  } catch (e) {
    console.log(`❌ Error deleting model: ${e.message}`);
    return false;
  }
}

async function monitorDownload() {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let lastBytes = 0;
    let lastPercent = 0;
    let stallCount = 0;
    let lastUpdateTime = Date.now();
    let totalBytesDownloaded = 0;
    
    console.log('\n📊 Download Progress Monitor');
    console.log('-'.repeat(60));
    
    const checkInterval = setInterval(() => {
      try {
        const progress = ghostNative.getParakeetDownloadProgress();
        const elapsed = (Date.now() - startTime) / 1000;
        // Handle both camelCase (from Rust NAPI) and snake_case (legacy)
        const currentBytes = progress.bytesDownloaded !== undefined ? progress.bytesDownloaded : (progress.bytes_downloaded || 0);
        const currentPercent = progress.percent || 0;
        const isDownloading = progress.isDownloading !== undefined ? progress.isDownloading : (progress.is_downloading || false);
        const currentFile = progress.currentFile || progress.current_file || '';
        const totalBytes = progress.totalBytes !== undefined ? progress.totalBytes : (progress.total_bytes || 0);
        
        // Calculate speed
        const timeDiff = (Date.now() - lastUpdateTime) / 1000;
        const bytesDiff = currentBytes - lastBytes;
        const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
        const avgSpeed = elapsed > 0 ? currentBytes / elapsed : 0;
        
        // Estimate time remaining
        const remainingBytes = totalBytes - currentBytes;
        const eta = speed > 0 ? remainingBytes / speed : 0;
        
        // Check for completion
        if (!isDownloading && downloadStarted) {
          clearInterval(checkInterval);
          
          if (progress.error) {
            console.log(`\n❌ Download failed: ${progress.error}`);
            resolve({ success: false, error: progress.error });
            return;
          }
          
          // Check if download actually completed
          const finalBytes = currentBytes;
          const finalPercent = currentPercent;
          
          // Give it a moment for file system to sync, then verify
          setTimeout(() => {
            const isDownloaded = ghostNative.isParakeetDownloaded();
            
            if (isDownloaded || finalPercent === 100 || (totalBytes > 0 && finalBytes >= totalBytes * 0.99)) {
              console.log(`\n✅ Download completed!`);
              console.log(`   Total time: ${formatTime(elapsed)}`);
              console.log(`   Total downloaded: ${formatBytes(finalBytes)}`);
              if (avgSpeed > 0) {
                console.log(`   Average speed: ${formatBytes(avgSpeed)}/s`);
              }
              console.log(`   Model verified: ${isDownloaded ? 'Yes' : 'Pending verification'}`);
              resolve({ success: true, bytes: finalBytes, time: elapsed });
            } else {
              console.log(`\n⚠️  Download stopped but not at 100%`);
              console.log(`   Progress: ${finalPercent}%`);
              console.log(`   Bytes: ${formatBytes(finalBytes)} / ${formatBytes(totalBytes)}`);
              console.log(`   Model verified: ${isDownloaded}`);
              // Still might be successful if files are there
              if (isDownloaded) {
                resolve({ success: true, bytes: finalBytes, time: elapsed });
              } else {
                resolve({ success: false, error: 'Download stopped prematurely' });
              }
            }
          }, 1000);
          return;
        }
        
        // Show progress if downloading
        if (isDownloading) {
          // Check for stall
          if (bytesDiff === 0 && currentBytes > 0 && elapsed > 5) {
            stallCount++;
            if (stallCount > 20) {
              console.log(`\n⚠️  Download stalled (no progress for ${Math.floor(stallCount * PROGRESS_CHECK_INTERVAL / 1000)}s)`);
            }
          } else {
            stallCount = 0;
          }
          
          // Update display
          const progressBar = '█'.repeat(Math.floor(currentPercent / 2)) + '░'.repeat(50 - Math.floor(currentPercent / 2));
          const fileInfo = currentFile ? ` | File: ${path.basename(currentFile)}` : '';
          const speedInfo = speed > 0 ? ` | Speed: ${formatBytes(speed)}/s` : '';
          const etaInfo = eta > 0 && eta < 3600 ? ` | ETA: ${formatTime(eta)}` : '';
          
          process.stdout.write(`\r[${progressBar}] ${currentPercent}% | ${formatBytes(currentBytes)}/${formatBytes(totalBytes)}${speedInfo}${etaInfo}${fileInfo}`);
          
          lastBytes = currentBytes;
          lastPercent = currentPercent;
          lastUpdateTime = Date.now();
          totalBytesDownloaded = currentBytes;
        }
        
        // Timeout check
        if (elapsed > DOWNLOAD_TIMEOUT / 1000) {
          clearInterval(checkInterval);
          console.log(`\n❌ Download timeout after ${formatTime(elapsed)}`);
          resolve({ success: false, error: 'Download timeout' });
        }
        
      } catch (e) {
        clearInterval(checkInterval);
        console.log(`\n❌ Error monitoring progress: ${e.message}`);
        resolve({ success: false, error: e.message });
      }
    }, PROGRESS_CHECK_INTERVAL);
  });
}

let downloadStarted = false;

async function testFullDownload() {
  // Step 0: Delete model if fresh download requested
  if (FRESH_DOWNLOAD) {
    const deleted = await deleteModel();
    if (!deleted) {
      console.log('❌ Failed to delete model');
      return false;
    }
    console.log('');
  }
  
  // Step 1: Check initial status
  console.log('Step 1: Checking initial status');
  console.log('-'.repeat(60));
  
  const isDownloaded = ghostNative.isParakeetDownloaded();
  const modelInfo = ghostNative.getParakeetModelInfo();
  const progress = ghostNative.getParakeetDownloadProgress();
  const isDownloading = progress.isDownloading !== undefined ? progress.isDownloading : progress.is_downloading;
  
  console.log(`Model downloaded: ${isDownloaded ? '✅ Yes' : '❌ No'}`);
  if (isDownloaded) {
    console.log(`Model version: ${modelInfo.version}`);
    console.log(`Model size: ${formatBytes(modelInfo.size)}`);
  }
  
  if (isDownloading) {
    console.log('\n⚠️  Download already in progress');
    console.log('   Monitoring existing download...');
    downloadStarted = true;
    const result = await monitorDownload();
    return result.success;
  }
  
  // Step 2: Start download
  console.log('\nStep 2: Starting download');
  console.log('-'.repeat(60));
  
  try {
    const started = ghostNative.downloadParakeetModel();
    if (!started) {
      console.log('❌ downloadParakeetModel() returned false');
      return false;
    }
    
    downloadStarted = true;
    console.log('✅ Download started');
    console.log('   Waiting for download to initialize...');
    await sleep(2000); // Wait longer for download to actually start
    
    // Check if download actually started
    const initialProgress = ghostNative.getParakeetDownloadProgress();
    const initialIsDownloading = initialProgress.isDownloading !== undefined ? initialProgress.isDownloading : initialProgress.is_downloading;
    if (!initialIsDownloading) {
      console.log('⚠️  Download not detected as active, checking again...');
      await sleep(2000);
      const checkProgress = ghostNative.getParakeetDownloadProgress();
      const checkIsDownloading = checkProgress.isDownloading !== undefined ? checkProgress.isDownloading : checkProgress.is_downloading;
      if (!checkIsDownloading) {
        console.log('❌ Download did not start properly');
        console.log('   Progress state:', JSON.stringify(checkProgress, null, 2));
        return false;
      }
    }
    
    console.log('✅ Download is active, monitoring progress...');
    
    // Step 3: Monitor download
    const result = await monitorDownload();
    
    if (!result.success) {
      return false;
    }
    
    // Step 4: Verify download
    console.log('\nStep 3: Verifying download');
    console.log('-'.repeat(60));
    
    await sleep(1000); // Brief pause for file system sync
    
    const verifyDownloaded = ghostNative.isParakeetDownloaded();
    const verifyInfo = ghostNative.getParakeetModelInfo();
    
    if (!verifyDownloaded) {
      console.log('❌ Model not marked as downloaded');
      return false;
    }
    
    console.log('✅ Model verification passed');
    console.log(`   Version: ${verifyInfo.version}`);
    console.log(`   Size: ${formatBytes(verifyInfo.size)}`);
    console.log(`   Path: ${verifyInfo.path}`);
    
    // Step 5: Test initialization
    console.log('\nStep 4: Testing initialization');
    console.log('-'.repeat(60));
    
    try {
      const initResult = ghostNative.initParakeet();
      if (!initResult) {
        console.log('❌ Initialization returned false');
        return false;
      }
      
      const isReady = ghostNative.isParakeetReady();
      if (!isReady) {
        console.log('❌ Model not ready after initialization');
        return false;
      }
      
      console.log('✅ Model initialized and ready');
      return true;
      
    } catch (e) {
      console.log(`❌ Initialization error: ${e.message}`);
      return false;
    }
    
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
    console.log('Stack:', e.stack);
    return false;
  }
}

// Main execution
(async () => {
  try {
    const success = await testFullDownload();
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary');
    console.log('='.repeat(60));
    console.log(`Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Mode: ${FRESH_DOWNLOAD ? 'Fresh Download' : 'Existing Model'}`);
    
    if (success) {
      console.log('\n✅ All download automation tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Tests failed');
      process.exit(1);
    }
    
  } catch (e) {
    console.log(`\n❌ Fatal error: ${e.message}`);
    console.log('Stack:', e.stack);
    process.exit(1);
  }
})();

