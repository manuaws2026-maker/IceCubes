//! Local LLM inference engine
//!
//! This module provides local language model inference using mistral.rs
//! with support for GGUF quantized models like Qwen2.5 3B.

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ErrorStrategy, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use parking_lot::Mutex;
use std::sync::Arc;
use once_cell::sync::Lazy;

// mistralrs imports
use mistralrs::{
    GgufModelBuilder, TextMessageRole, TextMessages, Model,
    RequestBuilder, Response, ChatCompletionChunkResponse, ChunkChoice, Delta,
};

// Model configuration for Qwen2.5 3B Instruct (public, no auth required)
const GGUF_REPO: &str = "Qwen/Qwen2.5-3B-Instruct-GGUF";
const GGUF_FILE: &str = "qwen2.5-3b-instruct-q4_k_m.gguf";
const TOKENIZER_REPO: &str = "Qwen/Qwen2.5-3B-Instruct";
const MODEL_SIZE_BYTES: u64 = 2_100_000_000; // ~2GB

// ============================================================================
// Global State
// ============================================================================

static LLM_STATE: Lazy<Mutex<Option<LlmEngine>>> = Lazy::new(|| Mutex::new(None));

static LLM_INIT_PROGRESS: Mutex<LlmInitProgress> = Mutex::new(LlmInitProgress {
    is_loading: false,
    status: String::new(),
    error: None,
});

// Tokio runtime for async operations
static TOKIO_RUNTIME: Lazy<tokio::runtime::Runtime> = Lazy::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create Tokio runtime")
});

// ============================================================================
// Types
// ============================================================================

#[napi(object)]
#[derive(Clone)]
pub struct LlmModelInfo {
    pub ready: bool,
    pub model_name: String,
    pub model_repo: String,
    pub model_file: String,
    pub estimated_size: i64,
}

#[napi(object)]
#[derive(Clone)]
pub struct LlmInitProgress {
    pub is_loading: bool,
    pub status: String,
    pub error: Option<String>,
}

#[napi(object)]
#[derive(Clone)]
pub struct LlmResponse {
    pub text: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub tokens_per_second: f64,
}

struct LlmEngine {
    model: Arc<Model>,
}

// ============================================================================
// NAPI Exports - Model Information
// ============================================================================

#[napi]
pub fn get_llm_model_info() -> LlmModelInfo {
    let ready = LLM_STATE.lock().is_some();
    
    LlmModelInfo {
        ready,
        model_name: "Qwen2.5 3B Instruct (Q4_K_M)".to_string(),
        model_repo: GGUF_REPO.to_string(),
        model_file: GGUF_FILE.to_string(),
        estimated_size: MODEL_SIZE_BYTES as i64,
    }
}

#[napi]
pub fn get_llm_init_progress() -> LlmInitProgress {
    LLM_INIT_PROGRESS.lock().clone()
}

#[napi]
pub fn is_llm_ready() -> bool {
    LLM_STATE.lock().is_some()
}

// ============================================================================
// NAPI Exports - Model Loading
// ============================================================================

/// Initialize the LLM - downloads model from HuggingFace if not cached
/// This is handled automatically by mistral.rs
#[napi]
pub fn init_llm() -> bool {
    // Check if already loading
    {
        let progress = LLM_INIT_PROGRESS.lock();
        if progress.is_loading {
            return false;
        }
    }
    
    // Check if already loaded
    {
        if LLM_STATE.lock().is_some() {
            return true;
        }
    }
    
    // Start loading in background
    {
        let mut progress = LLM_INIT_PROGRESS.lock();
        progress.is_loading = true;
        progress.status = "Starting model download/load...".to_string();
        progress.error = None;
    }
    
    std::thread::spawn(|| {
        do_init_llm();
    });
    
    true
}

fn do_init_llm() {
    println!("[LLM] Initializing Qwen2.5 3B...");
    println!("[LLM] Repo: {}", GGUF_REPO);
    println!("[LLM] File: {}", GGUF_FILE);
    println!("[LLM] Tokenizer: {}", TOKENIZER_REPO);
    
    {
        let mut progress = LLM_INIT_PROGRESS.lock();
        progress.status = "Downloading model from HuggingFace (if not cached)...".to_string();
    }
    
    let result = TOKIO_RUNTIME.block_on(async {
        // GgufModelBuilder automatically downloads from HuggingFace
        let model = GgufModelBuilder::new(
            GGUF_REPO,
            vec![GGUF_FILE.to_string()],
        )
        .with_tok_model_id(TOKENIZER_REPO)
        .with_logging()
        .build()
        .await
        .map_err(|e| format!("Model build error: {}", e))?;
        
        Ok::<_, String>(model)
    });
    
    match result {
        Ok(model) => {
            let mut state = LLM_STATE.lock();
            *state = Some(LlmEngine { model: Arc::new(model) });
            
            let mut progress = LLM_INIT_PROGRESS.lock();
            progress.is_loading = false;
            progress.status = "Model ready".to_string();
            progress.error = None;
            
            println!("[LLM] ✅ Model initialized successfully");
        }
        Err(e) => {
            let mut progress = LLM_INIT_PROGRESS.lock();
            progress.is_loading = false;
            progress.status = "Failed".to_string();
            progress.error = Some(e.clone());
            
            println!("[LLM] ❌ Init failed: {}", e);
        }
    }
}

/// Synchronous init that blocks until model is ready
#[napi]
pub fn init_llm_sync() -> Result<bool> {
    println!("[LLM] Initializing Qwen2.5 3B (sync)...");
    
    // Check if already loaded
    {
        if LLM_STATE.lock().is_some() {
            return Ok(true);
        }
    }
    
    let result = TOKIO_RUNTIME.block_on(async {
        let model = GgufModelBuilder::new(
            GGUF_REPO,
            vec![GGUF_FILE.to_string()],
        )
        .with_tok_model_id(TOKENIZER_REPO)
        .with_logging()
        .build()
        .await
        .map_err(|e| format!("Model build error: {}", e))?;
        
        Ok::<_, String>(model)
    });
    
    match result {
        Ok(model) => {
            let mut state = LLM_STATE.lock();
            *state = Some(LlmEngine { model: Arc::new(model) });
            println!("[LLM] ✅ Model initialized successfully");
            Ok(true)
        }
        Err(e) => {
            println!("[LLM] ❌ Init failed: {}", e);
            Err(Error::from_reason(e))
        }
    }
}

#[napi]
pub fn shutdown_llm() {
    let mut state = LLM_STATE.lock();
    *state = None;
    println!("[LLM] Shutdown complete");
}

// ============================================================================
// NAPI Exports - Inference
// ============================================================================

/// Generate text completion using the local LLM
#[napi]
pub fn llm_generate(prompt: String, _max_tokens: Option<u32>, _temperature: Option<f64>) -> Result<LlmResponse> {
    let state = LLM_STATE.lock();
    
    let engine = state.as_ref()
        .ok_or_else(|| Error::from_reason("LLM not initialized. Call init_llm() first."))?;
    
    println!("[LLM] Generate called with prompt length: {}", prompt.len());
    
    let model = engine.model.clone();
    drop(state); // Release lock before async operation
    
    let result = TOKIO_RUNTIME.block_on(async {
        let messages = TextMessages::new()
            .add_message(TextMessageRole::User, &prompt);
        
        let response = model.send_chat_request(messages).await
            .map_err(|e| format!("Generation error: {}", e))?;
        
        let text = response.choices.get(0)
            .and_then(|c| c.message.content.as_ref())
            .map(|s| s.to_string())
            .unwrap_or_default();
        
        Ok::<_, String>(LlmResponse {
            text,
            prompt_tokens: response.usage.prompt_tokens as u32,
            completion_tokens: response.usage.completion_tokens as u32,
            tokens_per_second: response.usage.avg_compl_tok_per_sec as f64,
        })
    });
    
    match result {
        Ok(response) => {
            println!("[LLM] ✅ Generated {} tokens at {:.1} tok/s", 
                response.completion_tokens, response.tokens_per_second);
            Ok(response)
        }
        Err(e) => {
            println!("[LLM] ❌ Generation failed: {}", e);
            Err(Error::from_reason(e))
        }
    }
}

/// Chat completion - takes messages array and returns response
/// Messages format: [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}]
#[napi]
pub fn llm_chat(messages_json: String, _max_tokens: Option<u32>, _temperature: Option<f64>) -> Result<LlmResponse> {
    let state = LLM_STATE.lock();
    
    let engine = state.as_ref()
        .ok_or_else(|| Error::from_reason("LLM not initialized. Call init_llm() first."))?;
    
    // Parse messages JSON
    let messages: Vec<serde_json::Value> = serde_json::from_str(&messages_json)
        .map_err(|e| Error::from_reason(format!("Invalid JSON: {}", e)))?;
    
    println!("[LLM] Chat called with {} messages", messages.len());
    
    let model = engine.model.clone();
    drop(state); // Release lock before async operation
    
    let result = TOKIO_RUNTIME.block_on(async {
        let mut text_messages = TextMessages::new();
        
        for msg in messages {
            let role_str = msg.get("role")
                .and_then(|r| r.as_str())
                .unwrap_or("user");
            let content = msg.get("content")
                .and_then(|c| c.as_str())
                .unwrap_or("");
            
            let role = match role_str {
                "system" => TextMessageRole::System,
                "assistant" => TextMessageRole::Assistant,
                _ => TextMessageRole::User,
            };
            
            text_messages = text_messages.add_message(role, content);
        }
        
        let response = model.send_chat_request(text_messages).await
            .map_err(|e| format!("Chat error: {}", e))?;
        
        let text = response.choices.get(0)
            .and_then(|c| c.message.content.as_ref())
            .map(|s| s.to_string())
            .unwrap_or_default();
        
        Ok::<_, String>(LlmResponse {
            text,
            prompt_tokens: response.usage.prompt_tokens as u32,
            completion_tokens: response.usage.completion_tokens as u32,
            tokens_per_second: response.usage.avg_compl_tok_per_sec as f64,
        })
    });
    
    match result {
        Ok(response) => {
            println!("[LLM] ✅ Chat response: {} tokens at {:.1} tok/s", 
                response.completion_tokens, response.tokens_per_second);
            Ok(response)
        }
        Err(e) => {
            println!("[LLM] ❌ Chat failed: {}", e);
            Err(Error::from_reason(e))
        }
    }
}

/// Stream chat completion - returns chunks as they're generated
/// This is useful for showing real-time responses
#[napi]
pub fn llm_chat_stream(messages_json: String, callback: JsFunction) -> Result<()> {
    let state = LLM_STATE.lock();
    
    let engine = state.as_ref()
        .ok_or_else(|| Error::from_reason("LLM not initialized. Call init_llm() first."))?;
    
    // Parse messages JSON
    let messages: Vec<serde_json::Value> = serde_json::from_str(&messages_json)
        .map_err(|e| Error::from_reason(format!("Invalid JSON: {}", e)))?;
    
    println!("[LLM] Stream chat called with {} messages", messages.len());
    
    let model = engine.model.clone();
    drop(state);
    
    // Create threadsafe function for callback
    let tsfn: ThreadsafeFunction<String, ErrorStrategy::Fatal> = callback
        .create_threadsafe_function(0, |ctx| {
            Ok(vec![ctx.value])
        })?;
    
    std::thread::spawn(move || {
        TOKIO_RUNTIME.block_on(async {
            let mut text_messages = TextMessages::new();
            
            for msg in messages {
                let role_str = msg.get("role")
                    .and_then(|r| r.as_str())
                    .unwrap_or("user");
                let content = msg.get("content")
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                
                let role = match role_str {
                    "system" => TextMessageRole::System,
                    "assistant" => TextMessageRole::Assistant,
                    _ => TextMessageRole::User,
                };
                
                text_messages = text_messages.add_message(role, content);
            }
            
            let request = RequestBuilder::from(text_messages);
            
            match model.stream_chat_request(request).await {
                Ok(mut stream) => {
                    while let Some(chunk) = stream.next().await {
                        if let Response::Chunk(ChatCompletionChunkResponse { choices, .. }) = chunk {
                            if let Some(ChunkChoice {
                                delta: Delta { content: Some(content), .. },
                                ..
                            }) = choices.first()
                            {
                                tsfn.call(content.clone(), ThreadsafeFunctionCallMode::NonBlocking);
                            }
                        }
                    }
                    // Signal completion
                    tsfn.call("[DONE]".to_string(), ThreadsafeFunctionCallMode::NonBlocking);
                }
                Err(e) => {
                    tsfn.call(format!("[ERROR] {}", e), ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
        });
    });
    
    Ok(())
}
