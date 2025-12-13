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

/// Check if LLM model is downloaded (cached by HuggingFace Hub)
#[napi]
pub fn is_llm_downloaded() -> bool {
    // HuggingFace Hub caches models at ~/.cache/huggingface/hub/
    // The model directory name is based on the repo name with -- replacing /
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => {
            println!("[LLM] Cannot determine home directory");
            return false;
        }
    };
    
    let cache_dir = home.join(".cache/huggingface/hub");
    let model_dir_name = format!("models--{}", GGUF_REPO.replace("/", "--"));
    let model_dir = cache_dir.join(&model_dir_name);
    
    println!("[LLM] Checking for model at: {}", model_dir.display());
    
    // Check if the snapshots directory exists and has content
    let snapshots_dir = model_dir.join("snapshots");
    if !snapshots_dir.exists() {
        println!("[LLM] Model not downloaded: snapshots dir not found");
        return false;
    }
    
    // Check if any snapshot has the GGUF file with reasonable size
    // The Q4_K_M model should be around 2GB
    const MIN_MODEL_SIZE: u64 = 1_500_000_000; // At least 1.5GB
    
    if let Ok(entries) = std::fs::read_dir(&snapshots_dir) {
        for entry in entries.flatten() {
            let gguf_path = entry.path().join(GGUF_FILE);
            if gguf_path.exists() {
                // Verify file size is reasonable
                if let Ok(metadata) = std::fs::metadata(&gguf_path) {
                    let size = metadata.len();
                    if size >= MIN_MODEL_SIZE {
                        println!("[LLM] ✅ Model found: {} ({:.2} GB)", gguf_path.display(), size as f64 / 1_000_000_000.0);
                        return true;
                    } else {
                        println!("[LLM] ⚠️ Model file too small: {} bytes (expected >= {})", size, MIN_MODEL_SIZE);
                    }
                }
            }
        }
    }
    
    println!("[LLM] ❌ Model not downloaded or incomplete");
    false
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

/// Delete the downloaded LLM model from HuggingFace cache
#[napi]
pub fn delete_llm_model() -> Result<bool> {
    // First shutdown the model if it's loaded
    {
        let mut state = LLM_STATE.lock();
        *state = None;
    }
    
    let home = dirs::home_dir()
        .ok_or_else(|| Error::from_reason("Cannot determine home directory"))?;
    
    let cache_dir = home.join(".cache/huggingface/hub");
    let model_dir_name = format!("models--{}", GGUF_REPO.replace("/", "--"));
    let model_dir = cache_dir.join(&model_dir_name);
    
    println!("[LLM] Deleting model at: {}", model_dir.display());
    
    if model_dir.exists() {
        std::fs::remove_dir_all(&model_dir)
            .map_err(|e| Error::from_reason(format!("Failed to delete model: {}", e)))?;
        println!("[LLM] ✅ Model deleted successfully");
        Ok(true)
    } else {
        println!("[LLM] Model directory not found, nothing to delete");
        Ok(false)
    }
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
    
    // Safety check: estimate total input tokens and reject if too large
    // Max safe input is ~3500 tokens (leaves room in 4096 context for response)
    let total_chars: usize = messages.iter()
        .map(|m| m.get("content").and_then(|c| c.as_str()).unwrap_or("").len())
        .sum();
    let estimated_tokens = total_chars / 4;
    const MAX_INPUT_TOKENS: usize = 3500;
    
    if estimated_tokens > MAX_INPUT_TOKENS {
        return Err(Error::from_reason(format!(
            "Input too large for local LLM: ~{} tokens (max {}). Try using OpenAI for longer content.",
            estimated_tokens, MAX_INPUT_TOKENS
        )));
    }
    
    println!("[LLM] Chat called with {} messages, ~{} input tokens", messages.len(), estimated_tokens);
    
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
/// max_tokens limits output length (default 2000 if not specified)
#[napi]
pub fn llm_chat_stream(messages_json: String, max_tokens: Option<u32>, callback: JsFunction) -> Result<()> {
    let state = LLM_STATE.lock();
    
    let engine = state.as_ref()
        .ok_or_else(|| Error::from_reason("LLM not initialized. Call init_llm() first."))?;
    
    // Parse messages JSON
    let messages: Vec<serde_json::Value> = serde_json::from_str(&messages_json)
        .map_err(|e| Error::from_reason(format!("Invalid JSON: {}", e)))?;
    
    // Safety check: estimate total input tokens and reject if too large
    // Max safe input is ~3500 tokens (leaves room in 4096 context for response)
    // Rough estimate: 4 chars per token
    let total_chars: usize = messages.iter()
        .map(|m| m.get("content").and_then(|c| c.as_str()).unwrap_or("").len())
        .sum();
    let estimated_tokens = total_chars / 4;
    const MAX_INPUT_TOKENS: usize = 3500;
    
    if estimated_tokens > MAX_INPUT_TOKENS {
        return Err(Error::from_reason(format!(
            "Input too large for local LLM: ~{} tokens (max {}). Try using OpenAI for longer content.",
            estimated_tokens, MAX_INPUT_TOKENS
        )));
    }
    
    let token_limit = max_tokens.unwrap_or(2000) as usize;
    println!("[LLM] Stream chat called with {} messages, ~{} input tokens, max_tokens: {}", 
             messages.len(), estimated_tokens, token_limit);
    
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
                    let mut token_count = 0usize;
                    let mut stopped_early = false;
                    
                    while let Some(chunk) = stream.next().await {
                        if let Response::Chunk(ChatCompletionChunkResponse { choices, .. }) = chunk {
                            if let Some(ChunkChoice {
                                delta: Delta { content: Some(content), .. },
                                ..
                            }) = choices.first()
                            {
                                // Rough token estimate: ~4 chars per token
                                token_count += (content.len() + 3) / 4;
                                
                                tsfn.call(content.clone(), ThreadsafeFunctionCallMode::NonBlocking);
                                
                                // Stop if we've exceeded token limit
                                if token_count >= token_limit {
                                    println!("[LLM] Stopping stream: reached {} tokens (limit: {})", token_count, token_limit);
                                    stopped_early = true;
                                    break;
                                }
                            }
                        }
                    }
                    
                    if stopped_early {
                        println!("[LLM] ✅ Stream completed (stopped at token limit)");
                    } else {
                        println!("[LLM] ✅ Stream completed naturally");
                    }
                    // Signal completion
                    tsfn.call("[DONE]".to_string(), ThreadsafeFunctionCallMode::NonBlocking);
                }
                Err(e) => {
                    println!("[LLM] ❌ Stream error: {}", e);
                    tsfn.call(format!("[ERROR] {}", e), ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
        });
    });
    
    Ok(())
}
