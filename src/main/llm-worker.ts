/**
 * LLM Worker - Runs LLM inference in a separate thread to avoid blocking UI
 */

import { parentPort, workerData } from 'worker_threads';

let nativeModule: any = null;

// Try to load native module
try {
  // Try direct require first
  nativeModule = require('ghost-native');
  console.log('[LLM Worker] Native module loaded directly');
} catch (e1) {
  // Try from passed path
  const nativeModulePath = workerData?.nativeModulePath;
  if (nativeModulePath) {
    try {
      nativeModule = require(nativeModulePath);
      console.log('[LLM Worker] Native module loaded from path:', nativeModulePath);
    } catch (e2) {
      console.error('[LLM Worker] Failed to load native module:', e2);
    }
  } else {
    console.error('[LLM Worker] No native module path provided and direct require failed:', e1);
  }
}

parentPort?.on('message', async (msg) => {
  if (msg.type === 'chat') {
    const { messagesJson, maxTokens, temperature, requestId } = msg;
    
    try {
      console.log('[LLM Worker] Processing chat request:', requestId);
      
      if (!nativeModule?.llmChat) {
        throw new Error('Native module not loaded or llmChat not available');
      }
      
      const result = nativeModule.llmChat(messagesJson, maxTokens, temperature);
      
      parentPort?.postMessage({
        type: 'result',
        requestId,
        result
      });
    } catch (e: any) {
      console.error('[LLM Worker] Error:', e);
      parentPort?.postMessage({
        type: 'error',
        requestId,
        error: e.message || String(e)
      });
    }
  } else if (msg.type === 'init') {
    // Initialize LLM if needed
    try {
      if (nativeModule?.initLlm) {
        nativeModule.initLlm();
      }
      parentPort?.postMessage({ type: 'init-done' });
    } catch (e: any) {
      parentPort?.postMessage({ type: 'init-error', error: e.message });
    }
  } else if (msg.type === 'isReady') {
    const ready = nativeModule?.isLlmReady?.() ?? false;
    parentPort?.postMessage({ type: 'isReady-result', ready });
  }
});

console.log('[LLM Worker] Worker started');

