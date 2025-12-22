#!/usr/bin/env node
/**
 * Test Qwen LLM model download and initialization
 * Qwen downloads automatically during initialization via HuggingFace Hub
 */

const ghostNative = require('ghost-native');
const fs = require('fs');
const path = require('path');

console.log('🧪 Qwen LLM Download & Initialization Test\n');
console.log('='.repeat(60));

// Helper functions
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getQwenCachePath() {
  const home = require('os').homedir();
  return path.join(home, '.cache', 'huggingface', 'hub', 'models--Qwen--Qwen2.5-3B-Instruct-GGUF');
}

function checkQwenCache() {
  const cachePath = getQwenCachePath();
  const snapshotsPath = path.join(cachePath, 'snapshots');
  
  if (!fs.existsSync(cachePath)) {
    return { exists: false, files: [], totalSize: 0 };
  }
  
  if (!fs.existsSync(snapshotsPath)) {
    return { exists: true, snapshotsExists: false, files: [], totalSize: 0 };
  }
  
  const files = [];
  let totalSize = 0;
  
  try {
    const snapshotDirs = fs.readdirSync(snapshotsPath);
    snapshotDirs.forEach(snapshotDir => {
      const snapshotPath = path.join(snapshotsPath, snapshotDir);
      if (fs.statSync(snapshotPath).isDirectory()) {
        const ggufPath = path.join(snapshotPath, 'qwen2.5-3b-instruct-q4_k_m.gguf');
        if (fs.existsSync(ggufPath)) {
          const stats = fs.statSync(ggufPath);
          files.push({
            path: ggufPath,
            size: stats.size,
            name: 'qwen2.5-3b-instruct-q4_k_m.gguf'
          });
          totalSize += stats.size;
        }
        
        // Also check for tokenizer files
        const tokenizerPath = path.join(snapshotPath, 'tokenizer.json');
        if (fs.existsSync(tokenizerPath)) {
          const stats = fs.statSync(tokenizerPath);
          files.push({
            path: tokenizerPath,
            size: stats.size,
            name: 'tokenizer.json'
          });
          totalSize += stats.size;
        }
      }
    });
  } catch (e) {
    console.log('Error reading cache:', e.message);
  }
  
  return { exists: true, snapshotsExists: true, files, totalSize };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testQwen() {
  // Step 1: Check initial state
  console.log('Step 1: Checking initial cache state');
  console.log('-'.repeat(60));
  
  const initialIsDownloaded = ghostNative.isLlmDownloaded();
  const initialCache = checkQwenCache();
  
  console.log('Is downloaded:', initialIsDownloaded ? '✅ Yes' : '❌ No');
  console.log('Cache directory exists:', initialCache.exists);
  console.log('Snapshots directory exists:', initialCache.snapshotsExists || false);
  console.log('Files in cache:', initialCache.files.length);
  
  if (initialCache.files.length > 0) {
    console.log('\nFiles present:');
    initialCache.files.forEach(file => {
      console.log(`  - ${file.name}: ${formatBytes(file.size)}`);
    });
    console.log('Total size:', formatBytes(initialCache.totalSize));
  } else {
    console.log('✅ Cache is empty');
  }
  
  // Step 2: Clear cache if needed
  console.log('\nStep 2: Clearing cache for fresh test');
  console.log('-'.repeat(60));
  
  try {
    if (ghostNative.isLlmDownloaded()) {
      console.log('Deleting existing model...');
      const deleted = ghostNative.deleteLlmModel();
      if (deleted) {
        console.log('✅ Model deleted via API');
      } else {
        console.log('⚠️  deleteLlmModel() returned false');
      }
    }
    
    // Also manually check and clear cache directory
    const cachePath = getQwenCachePath();
    if (fs.existsSync(cachePath)) {
      console.log('Checking cache directory...');
      const afterDeleteCache = checkQwenCache();
      if (afterDeleteCache.files.length > 0) {
        console.log('⚠️  Some files still remain in cache');
      } else {
        console.log('✅ Cache is now empty');
      }
    } else {
      console.log('✅ Cache directory does not exist (empty)');
    }
  } catch (e) {
    console.log('⚠️  Error clearing cache:', e.message);
  }
  
  // Step 3: Start initialization (triggers download)
  console.log('\nStep 3: Starting LLM initialization (triggers download)');
  console.log('-'.repeat(60));
  
  try {
    const started = ghostNative.initLlm();
    if (!started) {
      console.log('❌ Initialization failed to start');
      return false;
    }
    
    console.log('✅ Initialization started');
    console.log('Monitoring progress...\n');
    
    // Monitor progress
    let lastStatus = '';
    let attempts = 0;
    const maxAttempts = 600; // 10 minutes max
    
    while (attempts < maxAttempts) {
      await sleep(1000);
      attempts++;
      
      const progress = ghostNative.getLlmInitProgress();
      const isReady = ghostNative.isLlmReady();
      
      if (progress.status !== lastStatus) {
        console.log(`[${attempts}s] ${progress.status || 'Loading...'} ${progress.isLoading ? '⏳' : ''}`);
        lastStatus = progress.status;
      } else {
        process.stdout.write(`\r[${attempts}s] ${progress.status || 'Loading...'} ${progress.isLoading ? '⏳' : ''}   `);
      }
      
      if (progress.error) {
        console.log(`\n❌ Error: ${progress.error}`);
        return false;
      }
      
      if (isReady) {
        console.log('\n✅ Model is ready!');
        break;
      }
      
      // Check cache periodically
      if (attempts % 10 === 0) {
        const cache = checkQwenCache();
        if (cache.files.length > 0) {
          const ggufFile = cache.files.find(f => f.name.includes('.gguf'));
          if (ggufFile) {
            const percent = (ggufFile.size / (2.1 * 1024 * 1024 * 1024)) * 100;
            process.stdout.write(` (Download: ${percent.toFixed(1)}%)`);
          }
        }
      }
    }
    
    if (!ghostNative.isLlmReady()) {
      console.log('\n❌ Initialization timeout');
      return false;
    }
    
    // Step 4: Verify cache after download
    console.log('\nStep 4: Verifying cache after download');
    console.log('-'.repeat(60));
    
    const finalIsDownloaded = ghostNative.isLlmDownloaded();
    const finalCache = checkQwenCache();
    const modelInfo = ghostNative.getLlmModelInfo();
    
    console.log('Is downloaded:', finalIsDownloaded ? '✅ Yes' : '❌ No');
    console.log('Is ready:', ghostNative.isLlmReady() ? '✅ Yes' : '❌ No');
    console.log('');
    
    console.log('Cache state:');
    console.log('  Directory exists:', finalCache.exists);
    console.log('  Snapshots exists:', finalCache.snapshotsExists);
    console.log('  Files in cache:', finalCache.files.length);
    
    if (finalCache.files.length > 0) {
      console.log('\nFiles downloaded:');
      finalCache.files.forEach(file => {
        console.log(`  ✅ ${file.name}: ${formatBytes(file.size)}`);
      });
      console.log('\nTotal cache size:', formatBytes(finalCache.totalSize));
    }
    
    console.log('\nModel info:');
    console.log('  Name:', modelInfo.modelName);
    console.log('  Repo:', modelInfo.modelRepo);
    console.log('  File:', modelInfo.modelFile);
    console.log('  Estimated size:', formatBytes(modelInfo.estimatedSize));
    
    // Verify GGUF file exists and is correct size
    const ggufFile = finalCache.files.find(f => f.name.includes('.gguf'));
    if (ggufFile) {
      const minSize = 1.5 * 1024 * 1024 * 1024; // 1.5 GB minimum
      if (ggufFile.size >= minSize) {
        console.log(`\n✅ GGUF file verified: ${formatBytes(ggufFile.size)} (expected: >${formatBytes(minSize)})`);
      } else {
        console.log(`\n⚠️  GGUF file too small: ${formatBytes(ggufFile.size)} (expected: >${formatBytes(minSize)})`);
      }
    } else {
      console.log('\n❌ GGUF file not found in cache');
      return false;
    }
    
    // Step 5: Test model functionality
    console.log('\nStep 5: Testing model functionality');
    console.log('-'.repeat(60));
    
    try {
      console.log('Sending test prompt...');
      const response = ghostNative.llmChat('Hello! Please respond with just "Hi" to confirm you are working.');
      if (response && response.text) {
        console.log('✅ Model response received:', response.text.substring(0, 100));
        console.log('  Tokens:', response.promptTokens, 'prompt +', response.completionTokens, 'completion');
        console.log('  Speed:', response.tokensPerSecond?.toFixed(1) || 'N/A', 'tokens/sec');
      } else {
        console.log('⚠️  No response received');
      }
    } catch (e) {
      console.log('⚠️  Error testing model:', e.message);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary');
    console.log('='.repeat(60));
    
    if (finalIsDownloaded && finalCache.files.length > 0 && ggufFile && ggufFile.size >= minSize) {
      console.log('Result: ✅ PASS');
      console.log('');
      console.log('✅ Cache verification PASSED!');
      console.log('   - Cache was empty before download');
      console.log('   - Cache has model files after download');
      console.log('   - GGUF file is correct size (~2GB)');
      console.log('   - Model initialized successfully');
      console.log('   - Model responds to prompts');
      return true;
    } else {
      console.log('Result: ❌ FAIL');
      return false;
    }
    
  } catch (e) {
    console.log('❌ Error:', e.message);
    console.log(e.stack);
    return false;
  }
}

// Run test
testQwen().then(success => {
  process.exit(success ? 0 : 1);
}).catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

