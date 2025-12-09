#!/usr/bin/env node
/**
 * Test script for local LLM (Llama 3.2 via mistral.rs)
 * 
 * Usage: node test-llm.js
 */

const path = require('path');

// Load native module
const nativeModulePath = path.join(__dirname, 'src-native', 'ghost-native.darwin-arm64.node');
console.log('Loading native module from:', nativeModulePath);

let native;
try {
  native = require(nativeModulePath);
  console.log('✅ Native module loaded');
} catch (e) {
  console.error('❌ Failed to load native module:', e.message);
  process.exit(1);
}

// Check available functions
console.log('\nAvailable LLM functions:');
const llmFunctions = Object.keys(native).filter(k => k.toLowerCase().includes('llm'));
llmFunctions.forEach(fn => console.log('  -', fn));

async function testLLM() {
  console.log('\n' + '='.repeat(60));
  console.log('TESTING LOCAL LLM (Llama 3.2 3B)');
  console.log('='.repeat(60));

  // Check if LLM is ready
  const isReady = native.isLlmReady?.();
  console.log('\n1. LLM Ready:', isReady);

  if (!isReady) {
    console.log('\n2. Initializing LLM (this will download ~2GB if not cached)...');
    console.log('   This may take several minutes on first run.');
    
    try {
      const started = native.initLlm?.();
      console.log('   Init started:', started);
      
      // Poll for completion
      let ready = false;
      let attempts = 0;
      const maxAttempts = 300; // 5 minutes max
      
      while (!ready && attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
        const progress = native.getLlmInitProgress?.();
        
        if (progress) {
          process.stdout.write(`\r   Status: ${progress.status || 'Loading...'} ${progress.isLoading ? '⏳' : '✅'}    `);
          
          if (progress.error) {
            console.error('\n   ❌ Error:', progress.error);
            return;
          }
          
          if (!progress.isLoading) {
            ready = native.isLlmReady?.();
          }
        }
        attempts++;
      }
      console.log('');
      
      if (!ready) {
        console.error('   ❌ LLM init timed out');
        return;
      }
    } catch (e) {
      console.error('   ❌ Init error:', e.message);
      return;
    }
  }

  console.log('\n3. Testing chat completion...');
  
  // Sample meeting transcript
  const testTranscript = `
Hey everyone, thanks for joining. So today we need to discuss the Q4 roadmap.
I think we should prioritize the mobile app features, especially the offline mode.
Yeah, I agree. The offline mode has been requested by a lot of customers.
Right, and we also need to fix the performance issues on the dashboard.
Can we get that done by end of November? 
I think so, if we dedicate two engineers to it.
Great, let's do that. Also, don't forget we have the investor meeting next Tuesday.
I'll prepare the slides by Monday.
Perfect. Any other items?
Just one - we need to decide on the new hire for the backend team.
Let's schedule a separate call for that. Meeting adjourned.
`;

  const messages = JSON.stringify([
    {
      role: 'system',
      content: 'You are an AI meeting assistant. Generate concise meeting notes from the transcript. Include: Summary, Key Points, Action Items, and Decisions Made.'
    },
    {
      role: 'user',
      content: `Generate meeting notes from this transcript:\n\n${testTranscript}`
    }
  ]);

  try {
    console.log('   Sending request to Llama 3.2...');
    const startTime = Date.now();
    
    const result = native.llmChat?.(messages);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (result) {
      console.log(`\n   ✅ Response received in ${elapsed}s`);
      console.log(`   Tokens: ${result.completionTokens} completion, ${result.promptTokens} prompt`);
      console.log(`   Speed: ${result.tokensPerSecond?.toFixed(1)} tokens/sec`);
      console.log('\n' + '-'.repeat(60));
      console.log('GENERATED NOTES:');
      console.log('-'.repeat(60));
      console.log(result.text);
      console.log('-'.repeat(60));
    } else {
      console.error('   ❌ No response from LLM');
    }
  } catch (e) {
    console.error('   ❌ Chat error:', e.message);
  }
}

testLLM().then(() => {
  console.log('\n✅ Test complete');
  process.exit(0);
}).catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});

