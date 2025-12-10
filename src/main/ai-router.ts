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
 * Check if local LLM is ready
 */
export function isLocalLLMReady(): boolean {
  try {
    return nativeModule?.isLlmReady?.() ?? false;
  } catch (e) {
    return false;
  }
}

/**
 * Initialize local LLM (starts download if needed)
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
  
  // Determine which engine to actually use
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
  
  console.log(`[AIRouter] ✅ Using: ${useEngine.toUpperCase()}`);
  
  if (useEngine === 'local') {
    const result = await generateNotesWithLocalLLM(transcript, rawNotes, meetingTitle, meetingInfo, outputLanguage, template);
    console.log(`[AIRouter] Local LLM result: ${result ? 'SUCCESS' : 'NULL'}`);
    return result;
  } else {
    const result = await openaiService.generateEnhancedNotes(transcript, rawNotes, meetingTitle, meetingInfo, outputLanguage, template);
    console.log(`[AIRouter] OpenAI result: ${result ? 'SUCCESS' : 'NULL'}`);
    return result;
  }
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
    // Build the prompt similar to OpenAI version but simplified for local LLM
    const languageName = getLanguageName(outputLanguage);
    
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
Rules:
- Use ## headers for each section from the template
- Use **bold** for important terms and names
- Use bullet points (•) for key information
- Include action items with owner names when mentioned
- Be concise and focus on the most important information
- Do NOT add any headers like "Meeting Notes" at the top
- Do NOT include any explanation or commentary about the format
- Do NOT add meta-text like "This document outlines..." at the end
- Output ONLY the structured notes content`;

    const userPrompt = `Meeting Title: ${meetingTitle}

User's Notes:
${rawNotes || '(None)'}

Transcript:
${transcript}

Generate the enhanced notes now. Start directly with the first section header.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const messagesJson = JSON.stringify(messages);
    const result = nativeModule.llmChat(messagesJson, 2000, 0.3);
    
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
    
    return null;
  } catch (e: any) {
    console.error('[AIRouter] Local LLM note generation error:', e);
    return null;
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
  
  console.log(`[AIRouter] ❓ Using AI engine: ${engine.toUpperCase()} for Q&A - Question: "${question.substring(0, 50)}..."`);
  
  if (engine === 'local') {
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

