/**
 * AI Router - Routes AI requests to either OpenAI or Local LLM
 * 
 * This allows users to choose between cloud-based OpenAI and 
 * local Llama 3.2 inference via mistral.rs
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { OpenAIService, NoteGenerationResult } from './openai';

// Use same settings file as index.ts
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

/**
 * Run LLM with streaming - doesn't block main thread
 * Uses llm_chat_stream which runs in a separate thread and calls back with chunks
 */
async function runLLMStream(messagesJson: string, maxTokens: number = 2000): Promise<string | null> {
  if (!nativeModule?.llmChatStream) {
    console.log('[AIRouter] llmChatStream not available, falling back to blocking call');
    try {
      const result = nativeModule?.llmChat?.(messagesJson, maxTokens, 0.5);
      return result?.text || null;
    } catch (e) {
      console.error('[AIRouter] LLM fallback error:', e);
      return null;
    }
  }
  
  return new Promise((resolve, reject) => {
    let fullText = '';
    let resolved = false;
    
    // Timeout after 3 minutes (streaming should be faster)
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log('[AIRouter] LLM stream timed out, returning partial result:', fullText.length, 'chars');
        // Return what we have instead of rejecting
        resolve(fullText || null);
      }
    }, 3 * 60 * 1000);
    
    try {
      console.log('[AIRouter] Starting LLM stream with maxTokens:', maxTokens);
      nativeModule.llmChatStream(messagesJson, maxTokens, (chunk: string) => {
        if (resolved) return;
        
        if (chunk === '[DONE]') {
          resolved = true;
          clearTimeout(timeout);
          console.log('[AIRouter] LLM stream completed with', fullText.length, 'chars');
          resolve(fullText);
        } else if (chunk.startsWith('[ERROR]')) {
          resolved = true;
          clearTimeout(timeout);
          console.error('[AIRouter] LLM stream error:', chunk);
          reject(new Error(chunk.substring(8)));
        } else {
          fullText += chunk;
          // Log progress every 500 chars
          if (fullText.length % 500 < chunk.length) {
            console.log('[AIRouter] LLM streaming... ', fullText.length, 'chars');
          }
        }
      });
    } catch (e) {
      resolved = true;
      clearTimeout(timeout);
      console.error('[AIRouter] LLM stream setup error:', e);
      reject(e);
    }
  });
}

function readSettings(): Record<string, any> {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('[AIRouter] Error reading settings:', e);
  }
  return {};
}

export type AIEngine = 'openai' | 'local';

// Reference to native module (set from main process)
let nativeModule: any = null;

export function setNativeModuleForAI(module: any) {
  nativeModule = module;
}

/**
 * Get current AI engine preference
 */
export function getAIEngine(): AIEngine {
  const settings = readSettings();
  const engine = (settings.aiEngine as AIEngine) || 'openai';
  console.log(`[AIRouter] getAIEngine() = ${engine} (from settings.json)`);
  return engine;
}

/**
 * Set AI engine preference
 */
export function setAIEngine(engine: AIEngine): void {
  const settings = readSettings();
  settings.aiEngine = engine;
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    console.log('[AIRouter] Engine set to:', engine);
  } catch (e) {
    console.error('[AIRouter] Error saving engine:', e);
  }
}

/**
 * Check if local LLM is ready (loaded and ready to generate)
 */
export function isLocalLLMReady(): boolean {
  try {
    return nativeModule?.isLlmReady?.() ?? false;
  } catch (e) {
    return false;
  }
}

/**
 * Check if local LLM model is downloaded (file exists)
 */
export function isLocalLLMDownloaded(): boolean {
  try {
    return nativeModule?.isLlmDownloaded?.() ?? false;
  } catch (e) {
    return false;
  }
}

/**
 * Initialize local LLM (starts download if needed) - sync version
 */
export function initLocalLLM(): boolean {
  try {
    return nativeModule?.initLlm?.() ?? false;
  } catch (e) {
    console.error('[AIRouter] Failed to init local LLM:', e);
    return false;
  }
}

/**
 * Initialize local LLM - async version that waits for loading
 */
export async function initializeLocalLLM(): Promise<boolean> {
  try {
    console.log('[AIRouter] Initializing local LLM...');
    const started = nativeModule?.initLlm?.() ?? false;
    if (!started) {
      console.log('[AIRouter] Failed to start LLM initialization');
      return false;
    }
    
    // Wait for LLM to be ready (up to 30 seconds)
    const maxWait = 30000;
    const checkInterval = 500;
    let waited = 0;
    
    while (waited < maxWait) {
      if (isLocalLLMReady()) {
        console.log('[AIRouter] ✅ Local LLM ready after', waited, 'ms');
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }
    
    console.log('[AIRouter] ⏰ Timeout waiting for LLM to be ready');
    return false;
  } catch (e) {
    console.error('[AIRouter] Failed to initialize local LLM:', e);
    return false;
  }
}

/**
 * Chat completion using either OpenAI or local LLM
 * Returns the response text
 */
export async function chatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: {
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
  }
): Promise<string | null> {
  const engine = getAIEngine();
  const { maxTokens = 2000, temperature = 0.7 } = options || {};

  console.log(`[AIRouter] 🤖 Using AI engine: ${engine.toUpperCase()} for chat completion`);

  if (engine === 'local') {
    return localChatCompletion(messages, maxTokens, temperature);
  } else {
    return openAIChatCompletion(messages, maxTokens, temperature, options?.jsonMode);
  }
}

/**
 * Local LLM chat completion via mistral.rs
 */
async function localChatCompletion(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number
): Promise<string | null> {
  if (!nativeModule?.isLlmReady?.()) {
    console.error('[AIRouter] Local LLM not ready');
    return null;
  }

  try {
    const messagesJson = JSON.stringify(messages);
    const result = nativeModule.llmChat(messagesJson, maxTokens, temperature);
    
    if (result && result.text) {
      console.log(`[AIRouter] Local LLM response: ${result.completionTokens} tokens at ${result.tokensPerSecond?.toFixed(1)} tok/s`);
      return result.text;
    }
    return null;
  } catch (e: any) {
    console.error('[AIRouter] Local LLM error:', e);
    throw e;
  }
}

/**
 * OpenAI API chat completion
 */
async function openAIChatCompletion(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  temperature: number,
  jsonMode?: boolean
): Promise<string | null> {
  const settings = readSettings();
  const apiKey = settings.openaiKey as string;
  
  if (!apiKey) {
    console.error('[AIRouter] No OpenAI API key');
    return null;
  }

  try {
    const body: any = {
      model: 'gpt-4o',
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    
    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error: any = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const data: any = await response.json();
    return data.choices[0]?.message?.content || null;
  } catch (e: any) {
    console.error('[AIRouter] OpenAI error:', e);
    throw e;
  }
}

/**
 * Generate enhanced meeting notes using the configured AI engine
 */
export async function generateEnhancedNotesWithRouter(
  openaiService: OpenAIService,
  transcript: string,
  rawNotes: string,
  meetingTitle: string,
  meetingInfo?: any,
  outputLanguage: string = 'en',
  template?: any
): Promise<NoteGenerationResult | null> {
  const engine = getAIEngine();
  const localReady = isLocalLLMReady();
  const hasOpenAI = openaiService?.hasApiKey() ?? false;
  
  console.log(`[AIRouter] 📝 GENERATING ENHANCED NOTES`);
  console.log(`[AIRouter]   - Configured engine: ${engine.toUpperCase()}`);
  console.log(`[AIRouter]   - Local LLM ready: ${localReady}`);
  console.log(`[AIRouter]   - OpenAI available: ${hasOpenAI}`);
  console.log(`[AIRouter]   - Transcript length: ${transcript.length} chars`);
  
  // No automatic fallbacks - use the selected engine or fail with clear error
  console.log(`[AIRouter] ✅ Using: ${engine.toUpperCase()}`);
  
  if (engine === 'local') {
    // Retry logic: wait for LLM to be ready (2 retries, 3 second gaps)
    let currentlyReady = localReady;
    if (!currentlyReady) {
      console.log('[AIRouter] Local LLM not ready, waiting with retries...');
      for (let attempt = 1; attempt <= 2; attempt++) {
        console.log(`[AIRouter] Retry ${attempt}/2: waiting 3 seconds for LLM...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        currentlyReady = isLocalLLMReady();
        if (currentlyReady) {
          console.log(`[AIRouter] ✅ LLM became ready after ${attempt} retry(s)`);
          break;
        }
      }
    }
    
    if (!currentlyReady) {
      throw new Error('Local LLM is not ready after waiting. Please wait for it to initialize or switch to OpenAI in Settings.');
    }
    const result = await generateNotesWithLocalLLM(transcript, rawNotes, meetingTitle, meetingInfo, outputLanguage, template);
    console.log(`[AIRouter] Local LLM result: ${result ? 'SUCCESS' : 'NULL'}`);
    return result;
  } else {
    // OpenAI is selected
    if (!hasOpenAI) {
      throw new Error('OpenAI API key not configured. Please add your API key in Settings.');
    }
    
    const result = await openaiService.generateEnhancedNotes(transcript, rawNotes, meetingTitle, meetingInfo, outputLanguage, template);
    console.log(`[AIRouter] OpenAI result: ${result ? 'SUCCESS' : 'NULL'}`);
    if (result) return result;
    
    throw new Error('OpenAI returned no result. Please check your API key in Settings.');
  }
}

/**
 * Process long transcript in chunks for local LLM
 * Each chunk is summarized, then summaries are combined
 * 
 * IMPORTANT: Later chunks often contain action items and wrap-up,
 * so we give them MORE tokens and explicit prompting
 */
async function processTranscriptInChunks(
  transcript: string,
  meetingTitle: string,
  languageName: string
): Promise<string> {
  const CHUNK_SIZE = 5000; // Smaller chunks for better coverage
  const OVERLAP = 300;
  
  // Split transcript into chunks - ensure we get ALL content
  const chunks: string[] = [];
  let start = 0;
  while (start < transcript.length) {
    const end = Math.min(start + CHUNK_SIZE, transcript.length);
    chunks.push(transcript.substring(start, end));
    start = end - OVERLAP;
    // Only break if we've captured everything
    if (end >= transcript.length) break;
  }
  
  console.log(`[AIRouter] Split transcript into ${chunks.length} chunks (total: ${transcript.length} chars)`);
  
  // Process each chunk to extract key points
  // IMPORTANT: Give more tokens to later chunks (where action items typically are)
  const chunkSummaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const isLastChunk = i === chunks.length - 1;
    const isSecondToLast = i === chunks.length - 2;
    console.log(`[AIRouter] Processing chunk ${i + 1}/${chunks.length}${isLastChunk ? ' (FINAL - action items)' : ''}...`);
    
    // Later chunks get more tokens - action items and wrap-up are usually at the end
    const maxTokens = isLastChunk ? 1000 : (isSecondToLast ? 900 : 700);
    
    // Different prompts for different positions
    let chunkPrompt: string;
    if (isLastChunk) {
      chunkPrompt = `You are summarizing the FINAL part of a meeting transcript.
THIS IS THE MOST CRITICAL SECTION - late-mentioned items are often highest priority.

This section likely contains:
- ACTION ITEMS and assignments with DEADLINES
- Final decisions and next steps
- Wrap-up, blockers, and concerns raised at the end
- Last-minute risks or dependencies

CRITICAL REQUIREMENTS:
1. Extract EVERY action item with owner names and deadlines
2. Capture ALL blockers, dependencies, or follow-ups mentioned
3. Note any concerns, risks, or escalations discussed
4. Do NOT under-represent items just because they appear at the end
5. Items here may be MORE important than earlier content

Meeting: ${meetingTitle}
FINAL Transcript Section (${i + 1}/${chunks.length}):
${chunks[i]}

Extract ALL key points - prioritize ACTION ITEMS, BLOCKERS, and NEXT STEPS:`;
    } else if (i === 0) {
      chunkPrompt = `You are summarizing the BEGINNING of a meeting transcript.
Extract the main topics being introduced and any context-setting information.
Note key participants and their roles.

Meeting: ${meetingTitle}
Transcript Part ${i + 1}/${chunks.length}:
${chunks[i]}

Key points from this opening section:`;
    } else {
      chunkPrompt = `You are summarizing part ${i + 1} of ${chunks.length} of a meeting transcript.
Extract KEY POINTS, DECISIONS, and any ACTION ITEMS from this portion.
Preserve important details, names, technical terms, and specific numbers.

Meeting: ${meetingTitle}
Transcript Part ${i + 1}/${chunks.length}:
${chunks[i]}

Key points from this section:`;
    }

    const messages = [
      { role: 'system', content: 'You extract key points from meeting transcripts. Be thorough - capture all decisions, action items, and technical details. Use bullet points. Collapse repeated discussions into single entries - do NOT mirror the conversation flow.' },
      { role: 'user', content: chunkPrompt }
    ];

    try {
      const result = await runLLMStream(JSON.stringify(messages), maxTokens);
      if (result) {
        const label = isLastChunk ? '[FINAL - Action Items & Wrap-up]' : `[Part ${i + 1}]`;
        chunkSummaries.push(`${label}\n${result}`);
        console.log(`[AIRouter] Chunk ${i + 1} summarized: ${result.length} chars (${maxTokens} max tokens)`);
      }
    } catch (e) {
      console.error(`[AIRouter] Failed to process chunk ${i + 1}:`, e);
      // Include raw excerpt as fallback - more for later chunks
      const fallbackLength = isLastChunk ? 1500 : 800;
      chunkSummaries.push(`[Part ${i + 1}]\n${chunks[i].substring(0, fallbackLength)}...`);
    }
  }
  
  // Combine summaries - this becomes the "transcript" for final processing
  const combined = chunkSummaries.join('\n\n');
  console.log(`[AIRouter] Combined ${chunks.length} chunk summaries: ${combined.length} chars`);
  
  return combined;
}

/**
 * Generate notes using local LLM
 */
async function generateNotesWithLocalLLM(
  transcript: string,
  rawNotes: string,
  meetingTitle: string,
  meetingInfo?: any,
  outputLanguage: string = 'en',
  template?: any
): Promise<NoteGenerationResult | null> {
  if (!nativeModule?.isLlmReady?.()) {
    console.error('[AIRouter] Local LLM not ready for note generation');
    return null;
  }

  try {
    // TWO-PASS APPROACH for handling long content:
    // Pass 1: Generate AI notes from transcript (chunked if needed)
    // Pass 2: Merge raw notes into AI notes at appropriate places (if raw notes are substantial)
    
    const CHUNK_SIZE = 6000; // ~1500 tokens per chunk
    const RAW_NOTES_MERGE_THRESHOLD = 500; // If raw notes > this, do a merge pass
    const languageName = getLanguageName(outputLanguage);
    
    // ========== PASS 1: Process transcript ==========
    let processedTranscript = transcript;
    if (transcript && transcript.length > CHUNK_SIZE) {
      console.log(`[AIRouter] PASS 1: Transcript too long (${transcript.length} chars), processing in chunks...`);
      processedTranscript = await processTranscriptInChunks(transcript, meetingTitle, languageName);
      console.log(`[AIRouter] PASS 1: Chunked transcript complete: ${processedTranscript.length} chars`);
    } else if (transcript) {
      console.log(`[AIRouter] PASS 1: Transcript fits in context (${transcript.length} chars)`);
    } else {
      console.log(`[AIRouter] PASS 1: No transcript provided`);
      processedTranscript = '';
    }
    
    // Prepare raw notes - we'll handle them in pass 2 if they're substantial
    const hasSubstantialNotes = rawNotes && rawNotes.length > RAW_NOTES_MERGE_THRESHOLD;
    let notesForPass1 = '';
    
    // For pass 1, include a brief summary of raw notes if short, otherwise defer to pass 2
    if (rawNotes && rawNotes.length <= RAW_NOTES_MERGE_THRESHOLD) {
      notesForPass1 = rawNotes;
    } else if (hasSubstantialNotes) {
      // Just mention that notes exist - we'll merge them in pass 2
      notesForPass1 = `(User has ${rawNotes.length} chars of notes - will be merged after initial processing)`;
      console.log(`[AIRouter] Raw notes (${rawNotes.length} chars) will be merged in PASS 2`);
    }
    
    // Build the prompt similar to OpenAI version but simplified for local LLM
    
    // Build template sections prompt
    let templatePrompt = '';
    if (template && template.sections && template.sections.length > 0) {
      templatePrompt = `\n\nUse this template structure:\n`;
      template.sections.forEach((section: any, i: number) => {
        templatePrompt += `${i + 1}. ${section.title}: ${section.instructions}\n`;
      });
    }

    const systemPrompt = `You are an AI meeting assistant. Create enhanced meeting notes in ${languageName}.
${templatePrompt}

${template && template.sections && template.sections.length > 0 ? 
`CRITICAL: You MUST use ALL the template sections above as ## headers. Always include all of them, translated to ${languageName}.` : 
`Use standard sections: Summary, Key Points, Action Items, Decisions - translated to ${languageName}.`}

CRITICAL OUTPUT RULES:
- Do NOT mirror the conversation flow - synthesize and organize by topic
- Collapse repeated discussions into a single authoritative entry
- Each topic may appear ONLY ONCE in the final output
- Merge related points even if discussed at different times
- If the same action item or concern appears multiple times, list it ONCE with the strongest phrasing, owner, and deadline

ORDERING RULES:
- Order notes by PRIORITY and IMPACT, not by when they were discussed
- Items mentioned late but with high risk/urgency MUST appear at the top
- Critical bugs, blockers, and deadlines take precedence over general discussion

TAIL CAPTURE (CRITICAL):
Before finalizing, perform a "tail scan":
- Review the LAST 30% of the transcript carefully
- Identify any new risks, dependencies, blockers, or constraints
- Ensure NONE are lost or under-represented
- Promote late-mentioned critical items appropriately in the output

Formatting Rules:
- Use ## headers for TEMPLATE SECTIONS (required - include all of them)
- Within each template section, organize content by DISTINCT topics
- Use **bold** for important terms, names, quotes, decisions, technical terms
- Use bullet points (-) for key information with sub-bullets for details
- Include action items with owner names: "- **PersonName**: Action to take"
- PRESERVE ALL technical terms, system names, IDs, API names, and implementation details
- Include people's names and their specific contributions
- Be thorough and capture important context
- Do NOT add headers like "Meeting Notes" at the top
- Do NOT add meta-text or commentary
- Output ONLY the structured notes content

CRITICAL - USER'S PERSONAL NOTES:
- User notes are reminders typed by the user — NOT spoken in the meeting
- Include ALL user notes in relevant template sections
- Fix typos in user notes
- These are HIGH PRIORITY`;

    const userPrompt = `Meeting Title: ${meetingTitle}

User's Notes:
${notesForPass1 || '(None)'}

Transcript:
${processedTranscript || '(No transcript)'}

Generate the enhanced notes now. Start directly with the first section header.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const messagesJson = JSON.stringify(messages);
    
    // Use streaming LLM to avoid blocking the main thread
    // Limit to 2000 tokens (~8000 chars) for reasonable response time
    const maxTokens = 2000;
    console.log('[AIRouter] PASS 1: Starting local LLM streaming inference (max', maxTokens, 'tokens)...');
    let result: any = null;
    try {
      const streamResult = await runLLMStream(messagesJson, maxTokens);
      if (streamResult) {
        result = { text: streamResult, completionTokens: Math.ceil(streamResult.length / 4) };
        console.log('[AIRouter] PASS 1 complete:', streamResult.length, 'chars');
      }
    } catch (e: any) {
      console.error('[AIRouter] PASS 1 error:', e);
      const errorMsg = e.message || String(e);
      if (errorMsg.includes('too large') || errorMsg.includes('max')) {
        throw new Error(`Content too long for local LLM. Please use OpenAI for longer meetings.`);
      }
      throw new Error(`Local LLM error: ${errorMsg}`);
    }
    
    // ========== PASS 2: Merge raw notes into AI notes (if substantial) ==========
    if (result && result.text && hasSubstantialNotes) {
      console.log(`[AIRouter] PASS 2: Merging ${rawNotes.length} chars of raw notes into AI notes...`);
      
      // Process raw notes in chunks if they're very long
      let processedRawNotes = rawNotes;
      if (rawNotes.length > CHUNK_SIZE) {
        console.log(`[AIRouter] PASS 2: Raw notes too long, summarizing in chunks...`);
        processedRawNotes = await processTranscriptInChunks(rawNotes, 'User Notes', languageName);
        console.log(`[AIRouter] PASS 2: Raw notes summarized to ${processedRawNotes.length} chars`);
      }
      
      const mergePrompt = `You have AI-generated meeting notes and the user's personal notes.
Your task: MERGE the user's notes into the AI notes at the appropriate places.

RULES:
- Keep the AI notes structure (headers, sections)
- Insert user notes where they're most relevant (match topics)
- Mark user notes with "📝" prefix so they're visible
- Fix typos in user notes
- Don't duplicate information - integrate smoothly
- If a user note doesn't fit anywhere, add a "## Personal Notes" section at the end

AI-Generated Notes:
${result.text}

---

User's Personal Notes to Merge:
${processedRawNotes}

---

Output the merged notes (keep the same structure, integrate user notes):`;

      const mergeMessages = [
        { role: 'system', content: 'You merge user notes into AI-generated meeting notes. Preserve structure, integrate notes at relevant places.' },
        { role: 'user', content: mergePrompt }
      ];
      
      try {
        const mergeResult = await runLLMStream(JSON.stringify(mergeMessages), 2500);
        if (mergeResult && mergeResult.length > result.text.length * 0.5) {
          // Only use merge result if it's substantial
          result.text = mergeResult;
          console.log(`[AIRouter] PASS 2 complete: Merged notes are ${mergeResult.length} chars`);
        } else {
          console.log(`[AIRouter] PASS 2: Merge result too short, keeping original`);
        }
      } catch (e) {
        console.error('[AIRouter] PASS 2 merge failed, keeping original notes:', e);
        // Keep the original pass 1 result
      }
    }
    
    if (result && result.text) {
      console.log(`[AIRouter] Local LLM notes: ${result.completionTokens} tokens`);
      
      // Parse the response - local LLM returns plain markdown, not JSON
      // We need to extract summary and enhanced notes from the markdown
      const text = result.text;
      
      // Try to extract summary (first paragraph or section)
      let summary = '';
      let enhancedNotes = text;
      
      const summaryMatch = text.match(/^(.+?)(?=\n##|\n\n##)/s);
      if (summaryMatch) {
        summary = summaryMatch[1].replace(/^#+\s*Summary\s*/i, '').trim();
        enhancedNotes = text.substring(summaryMatch[0].length).trim();
      } else {
        // Take first 200 chars as summary
        summary = text.substring(0, 200).split('\n')[0];
      }
      
      return {
        summary,
        keyPoints: [],
        actionItems: [],
        decisions: [],
        enhancedNotes,
        templateId: template?.id,
      } as any;
    }
    
    // No result from LLM
    throw new Error('Local LLM returned no output. The model may be busy or the input was invalid.');
  } catch (e: any) {
    console.error('[AIRouter] Local LLM note generation error:', e);
    // Re-throw to propagate to UI
    throw e;
  }
}

/**
 * Ask a question about the meeting
 */
export async function askQuestionWithRouter(
  openaiService: OpenAIService,
  question: string,
  transcript: string,
  notes: string,
  meetingTitle: string
): Promise<string | null> {
  const engine = getAIEngine();
  const localReady = isLocalLLMReady();
  const hasOpenAI = openaiService?.hasApiKey() ?? false;
  
  console.log(`[AIRouter] ❓ Q&A Request:`);
  console.log(`[AIRouter]   - Configured engine: ${engine.toUpperCase()}`);
  console.log(`[AIRouter]   - Local LLM ready: ${localReady}`);
  console.log(`[AIRouter]   - OpenAI available: ${hasOpenAI}`);
  console.log(`[AIRouter]   - Question: "${question.substring(0, 50)}..."`);
  
  // Determine which engine to use
  let useEngine = engine;
  
  if (engine === 'local' && !localReady) {
    console.log(`[AIRouter] ⚠️ Local LLM not ready, falling back to OpenAI`);
    if (hasOpenAI) {
      useEngine = 'openai';
    } else {
      console.log(`[AIRouter] ❌ No AI engine available!`);
      return null;
    }
  }
  
  if (engine === 'openai' && !hasOpenAI) {
    console.log(`[AIRouter] ⚠️ No OpenAI key, trying local LLM`);
    if (localReady) {
      useEngine = 'local';
    } else {
      console.log(`[AIRouter] ❌ No AI engine available!`);
      return null;
    }
  }
  
  console.log(`[AIRouter] ✅ Using: ${useEngine.toUpperCase()} for Q&A`);
  
  if (useEngine === 'local') {
    return askQuestionWithLocalLLM(question, transcript, notes, meetingTitle);
  } else {
    return openaiService.askQuestion(question, transcript, notes, meetingTitle);
  }
}

/**
 * Ask question using local LLM
 */
async function askQuestionWithLocalLLM(
  question: string,
  transcript: string,
  notes: string,
  meetingTitle: string
): Promise<string | null> {
  const isReady = nativeModule?.isLlmReady?.();
  console.log(`[AIRouter] Local LLM ready status: ${isReady}`);
  
  if (!isReady) {
    console.error('[AIRouter] ❌ Local LLM not ready for Q&A');
    return null;
  }

  try {
    console.log('[AIRouter] Generating Q&A response with local LLM...');
    const systemPrompt = `You are a helpful AI assistant that answers questions about meeting content.
You have access to the meeting transcript and notes.
Be concise and helpful. Use markdown formatting for clarity.`;

    const userPrompt = `Meeting: ${meetingTitle}

Notes:
${notes || '(No notes)'}

Transcript:
${transcript}

Question: ${question}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const messagesJson = JSON.stringify(messages);
    const result = nativeModule.llmChat(messagesJson, 1000, 0.7);
    
    console.log(`[AIRouter] ✅ Local LLM Q&A completed, response length: ${result?.text?.length || 0} chars`);
    return result?.text || null;
  } catch (e: any) {
    console.error('[AIRouter] ❌ Local LLM Q&A error:', e);
    return null;
  }
}

/**
 * Suggest template using AI
 */
export async function suggestTemplateWithRouter(
  openaiService: OpenAIService,
  meetingTitle: string,
  rawNotes: string,
  transcriptPreview: string,
  templates: any[]
): Promise<{ templateId: string; confidence: string } | null> {
  const engine = getAIEngine();
  
  // For template suggestion, always use OpenAI if available (faster, more accurate)
  // Fall back to local only if OpenAI is not configured
  if (engine === 'openai' || !nativeModule?.isLlmReady?.()) {
    return openaiService.suggestTemplate(meetingTitle, rawNotes, transcriptPreview, templates);
  }
  
  // Use local LLM for template suggestion
  try {
    const templateList = templates.map((t, i) => `${i + 1}. "${t.name}": ${t.description || 'No description'}`).join('\n');
    
    const systemPrompt = `You are a meeting note template selector. Given a meeting title and content preview, select the most appropriate template.
Output ONLY the template number (1, 2, 3, etc.) and nothing else.`;

    const userPrompt = `Meeting: ${meetingTitle}

Content preview:
${transcriptPreview.substring(0, 500)}

Available templates:
${templateList}

Which template number is most appropriate?`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const result = nativeModule.llmChat(JSON.stringify(messages), 50, 0.1);
    
    if (result?.text) {
      const match = result.text.match(/(\d+)/);
      if (match) {
        const index = parseInt(match[1]) - 1;
        if (index >= 0 && index < templates.length) {
          return {
            templateId: templates[index].id,
            confidence: 'medium'
          };
        }
      }
    }
    
    // Fallback to first template
    return { templateId: templates[0]?.id || 'general', confidence: 'low' };
  } catch (e) {
    console.error('[AIRouter] Local template suggestion error:', e);
    return { templateId: 'general', confidence: 'low' };
  }
}

/**
 * Suggest folder using AI - routes to OpenAI or local LLM
 */
export async function suggestFolderWithRouter(
  openaiService: OpenAIService,
  noteContent: string,
  meetingTitle: string,
  folders: Array<{ id: string; name: string; description: string }>
): Promise<{ folderId: string; confidence: 'high' | 'medium' | 'low'; reason: string } | null> {
  const engine = getAIEngine();
  
  console.log(`[AIRouter] suggestFolderWithRouter called - engine: ${engine}, folders: ${folders.length}`);
  
  // Use OpenAI if selected and available
  if (engine === 'openai' && openaiService?.hasApiKey()) {
    console.log('[AIRouter] Using OpenAI for folder suggestion');
    return openaiService.suggestFolder(noteContent, meetingTitle, folders);
  }
  
  // Use local LLM if ready
  if (nativeModule?.isLlmReady?.()) {
    console.log('[AIRouter] Using local LLM (Qwen) for folder suggestion');
    try {
      const folderList = folders.map((f, i) => {
        const desc = f.description && f.description.trim().length > 0 
          ? f.description 
          : '(match based on folder name)';
        return `${i + 1}. "${f.name}" - ${desc}`;
      }).join('\n');

      const systemPrompt = `You are a folder classification assistant. Analyze the meeting content and suggest the most appropriate folder.

Output ONLY valid JSON in this exact format:
{"number": N, "confidence": "high|medium|low", "reason": "brief explanation"}

Where N is the folder number (1, 2, 3, etc.) or 0 if no folder matches.

Rules:
- "high" = content clearly matches folder purpose (70%+ sure)
- "medium" = content somewhat matches (50-70% sure)
- "low" = weak match (30-50% sure)
- Use 0 if confidence would be below "low"`;

      const userPrompt = `Meeting Title: ${meetingTitle}

Meeting Content:
${noteContent.substring(0, 1500)}

Available Folders:
${folderList}

Which folder number best matches this meeting? Output JSON only.`;

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      console.log('[AIRouter] Calling local LLM for folder suggestion...');
      const result = nativeModule.llmChat(JSON.stringify(messages), 150, 0.2);
      
      if (result?.text) {
        console.log('[AIRouter] Local LLM response:', result.text);
        
        // Try to parse JSON from response
        const jsonMatch = result.text.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            const folderIndex = parseInt(parsed.number) - 1;
            
            if (folderIndex >= 0 && folderIndex < folders.length && 
                (parsed.confidence === 'high' || parsed.confidence === 'medium')) {
              console.log('[AIRouter] Local LLM suggested folder:', folders[folderIndex].name, 
                          'with', parsed.confidence, 'confidence');
              return {
                folderId: folders[folderIndex].id,
                confidence: parsed.confidence,
                reason: parsed.reason || 'Matched by local AI'
              };
            }
          } catch (parseErr) {
            console.warn('[AIRouter] Failed to parse JSON from local LLM:', parseErr);
          }
        }
        
        // Fallback: try to extract just a number
        const numMatch = result.text.match(/(\d+)/);
        if (numMatch) {
          const folderIndex = parseInt(numMatch[1]) - 1;
          if (folderIndex >= 0 && folderIndex < folders.length) {
            console.log('[AIRouter] Local LLM suggested folder (fallback):', folders[folderIndex].name);
            return {
              folderId: folders[folderIndex].id,
              confidence: 'medium',
              reason: 'Matched by local AI'
            };
          }
        }
      }
      
      console.log('[AIRouter] No strong folder match from local LLM');
      return null;
    } catch (e) {
      console.error('[AIRouter] Local folder suggestion error:', e);
      return null;
    }
  }
  
  // Fallback to OpenAI if local not ready but OpenAI available
  if (openaiService?.hasApiKey()) {
    console.log('[AIRouter] Falling back to OpenAI for folder suggestion');
    return openaiService.suggestFolder(noteContent, meetingTitle, folders);
  }
  
  console.log('[AIRouter] No AI available for folder suggestion');
  return null;
}

// Helper function to get language name
function getLanguageName(code: string): string {
  const languages: Record<string, string> = {
    'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
    'it': 'Italian', 'pt': 'Portuguese', 'nl': 'Dutch', 'pl': 'Polish',
    'ru': 'Russian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
    'ar': 'Arabic', 'hi': 'Hindi', 'tr': 'Turkish', 'vi': 'Vietnamese',
    'th': 'Thai', 'id': 'Indonesian', 'ms': 'Malay', 'sv': 'Swedish',
    'no': 'Norwegian', 'da': 'Danish', 'fi': 'Finnish', 'el': 'Greek',
    'cs': 'Czech', 'ro': 'Romanian', 'hu': 'Hungarian', 'uk': 'Ukrainian',
  };
  return languages[code] || 'English';
}

