import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const API_KEY_PATH = path.join(app.getPath('userData'), 'openai-key.enc');

export interface NoteGenerationResult {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  decisions: string[];
  templateId?: string;  // ID of template used for generation
}

export class OpenAIService {
  private apiKey: string | null = null;
  private lastProcessedIndex: number = 0;
  private currentSummary: string = '';
  private lastGenerationTime: number = 0;
  private pendingTranscript: string[] = [];
  
  // Minimum interval between note generations (2 minutes)
  private readonly MIN_GENERATION_INTERVAL = 2 * 60 * 1000;
  // Minimum new content before regenerating (characters)
  private readonly MIN_NEW_CONTENT = 200;

  constructor() {
    this.loadApiKey();
  }

  private loadApiKey(): void {
    try {
      if (fs.existsSync(API_KEY_PATH)) {
        const encrypted = fs.readFileSync(API_KEY_PATH, 'utf-8');
        if (safeStorage.isEncryptionAvailable()) {
          const buffer = Buffer.from(encrypted, 'base64');
          this.apiKey = safeStorage.decryptString(buffer);
          console.log('[OpenAI] API key loaded from secure storage');
        } else {
          this.apiKey = encrypted;
        }
      }
    } catch (e) {
      console.error('[OpenAI] Failed to load API key:', e);
    }
  }

  saveApiKey(key: string): boolean {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(key);
        fs.writeFileSync(API_KEY_PATH, encrypted.toString('base64'));
      } else {
        fs.writeFileSync(API_KEY_PATH, key);
      }
      this.apiKey = key;
      console.log('[OpenAI] API key saved securely');
      return true;
    } catch (e) {
      console.error('[OpenAI] Failed to save API key:', e);
      return false;
    }
  }

  hasApiKey(): boolean {
    return !!this.apiKey;
  }

  getApiKey(): string | null {
    return this.apiKey;
  }

  clearApiKey(): void {
    console.log('[OpenAI] clearApiKey called, current apiKey:', !!this.apiKey);
    if (fs.existsSync(API_KEY_PATH)) {
      fs.unlinkSync(API_KEY_PATH);
      console.log('[OpenAI] Deleted API key file');
    }
    this.apiKey = null;
    console.log('[OpenAI] API key cleared from memory');
  }

  // Reset state for a new meeting
  resetSession(): void {
    this.lastProcessedIndex = 0;
    this.currentSummary = '';
    this.lastGenerationTime = 0;
    this.pendingTranscript = [];
  }

  // Check if we should generate notes (based on time and content)
  shouldGenerateNotes(transcript: string[]): boolean {
    const now = Date.now();
    const timeSinceLastGen = now - this.lastGenerationTime;
    
    // Get new content since last processing
    const newContent = transcript.slice(this.lastProcessedIndex).join(' ');
    
    // Generate if enough time has passed AND there's enough new content
    return (
      this.apiKey !== null &&
      timeSinceLastGen >= this.MIN_GENERATION_INTERVAL &&
      newContent.length >= this.MIN_NEW_CONTENT
    );
  }

  // Generate notes from transcript (incremental)
  async generateNotes(
    transcript: string[],
    meetingTitle: string,
    existingNotes: string = ''
  ): Promise<NoteGenerationResult | null> {
    if (!this.apiKey) {
      console.log('[OpenAI] No API key configured');
      return null;
    }

    // Get only new transcript content
    const newTranscriptParts = transcript.slice(this.lastProcessedIndex);
    if (newTranscriptParts.length === 0) {
      console.log('[OpenAI] No new transcript content');
      return null;
    }

    const newContent = newTranscriptParts.join('\n');
    console.log(`[OpenAI] Generating notes from ${newTranscriptParts.length} new segments`);

    try {
      // System prompt is kept consistent for caching benefits
      // OpenAI caches prompts >= 1024 tokens automatically (50% discount)
      const systemPrompt = `You are an AI meeting assistant that generates concise, actionable meeting notes.

Your task is to analyze meeting transcript segments and update/create structured notes.

Output Format (JSON):
{
  "summary": "2-3 sentence summary of the key discussion points",
  "keyPoints": ["Important point 1", "Important point 2"],
  "actionItems": ["Action: [Person] to do X by [date]"],
  "decisions": ["Decision made about X"]
}

Guidelines:
- Be concise and actionable
- Extract specific names, dates, and commitments when mentioned
- Focus on decisions, action items, and key information
- Ignore small talk and filler content
- If updating existing notes, merge new information appropriately
- Return valid JSON only, no markdown`;

      const userPrompt = `Meeting: ${meetingTitle}

${this.currentSummary ? `Previous Summary:\n${this.currentSummary}\n\n` : ''}${existingNotes ? `Existing Notes:\n${existingNotes}\n\n` : ''}New Transcript Segments:
${newContent}

Generate updated meeting notes in JSON format:`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // Much cheaper, good for incremental updates
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3, // Lower temperature for more consistent output
          max_tokens: 1000,
          response_format: { type: 'json_object' }, // Ensure JSON output
        }),
      });

      if (!response.ok) {
        const error: any = await response.json();
        console.error('[OpenAI] API error:', error);
        throw new Error(error.error?.message || 'API request failed');
      }

      const data: any = await response.json();
      
      // Log token usage for cost monitoring
      const usage = data.usage;
      console.log(`[OpenAI] Tokens used - Input: ${usage?.prompt_tokens}, Output: ${usage?.completion_tokens}, Cached: ${usage?.prompt_tokens_details?.cached_tokens || 0}`);
      
      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in response');
      }

      const result: NoteGenerationResult = JSON.parse(content);
      
      // Update state
      this.lastProcessedIndex = transcript.length;
      this.currentSummary = result.summary;
      this.lastGenerationTime = Date.now();

      console.log('[OpenAI] Notes generated successfully');
      return result;

    } catch (error: any) {
      console.error('[OpenAI] Failed to generate notes:', error);
      return null;
    }
  }

  // Language code to name mapping
  private getLanguageName(code: string): string {
    const languages: Record<string, string> = {
      'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
      'it': 'Italian', 'pt': 'Portuguese', 'nl': 'Dutch', 'ja': 'Japanese',
      'zh': 'Chinese', 'ko': 'Korean', 'ru': 'Russian', 'hi': 'Hindi',
      'ar': 'Arabic', 'pl': 'Polish', 'tr': 'Turkish', 'same': ''
    };
    return languages[code] || 'English';
  }

  // Generate final polished notes (uses GPT-4o for quality)
  async generateFinalSummary(
    transcript: string[],
    meetingTitle: string,
    userNotes: string,
    outputLanguage: string = 'same',
    transcriptLanguage: string = 'en'
  ): Promise<NoteGenerationResult | null> {
    if (!this.apiKey) {
      return null;
    }

    const fullTranscript = transcript.join('\n');
    const targetLang = outputLanguage === 'same' ? this.getLanguageName(transcriptLanguage) : this.getLanguageName(outputLanguage);
    const shouldTranslate = outputLanguage !== 'same' && outputLanguage !== transcriptLanguage;
    
    console.log(`[OpenAI] Generating final summary with GPT-4o in ${targetLang}${shouldTranslate ? ' (translating)' : ''}`);

    const languageInstruction = shouldTranslate 
      ? `\n\nIMPORTANT: Generate all notes in ${targetLang}. Translate content from the transcript as needed.`
      : `\n\nGenerate notes in ${targetLang}.`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o', // Use GPT-4o for final polish
          messages: [
            {
              role: 'system',
              content: `You are an expert meeting summarizer. Create comprehensive, well-organized meeting notes.

Output Format (JSON):
{
  "summary": "Executive summary of the entire meeting (3-5 sentences)",
  "keyPoints": ["All important discussion points"],
  "actionItems": ["Action: [Person] to do X by [date/timeframe]"],
  "decisions": ["All decisions made during the meeting"]
}

Be thorough but concise. Prioritize actionable information.${languageInstruction}`,
            },
            {
              role: 'user',
              content: `Meeting: ${meetingTitle}

User's Notes:
${userNotes || '(No user notes)'}

Full Transcript:
${fullTranscript}

Generate comprehensive final meeting notes in JSON format:`,
            },
          ],
          temperature: 0.3,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const error: any = await response.json();
        throw new Error(error.error?.message || 'API request failed');
      }

      const data: any = await response.json();
      const usage = data.usage;
      console.log(`[OpenAI] Final summary tokens - Input: ${usage?.prompt_tokens}, Output: ${usage?.completion_tokens}`);

      const content = data.choices[0]?.message?.content;
      return JSON.parse(content);

    } catch (error: any) {
      console.error('[OpenAI] Failed to generate final summary:', error);
      return null;
    }
  }

  // ============================================================================
  // ENHANCED NOTES
  // Generated AFTER meeting ends using: transcript + raw notes + meeting info
  // ============================================================================
  async generateEnhancedNotes(
    transcript: string,
    rawNotes: string,
    meetingTitle: string,
    meetingInfo?: any,
    outputLanguage: string = 'en',
    template?: any
  ): Promise<NoteGenerationResult | null> {
    if (!this.apiKey) {
      console.log('[OpenAI] No API key configured');
      return null;
    }

    console.log('[OpenAI] Generating enhanced notes in:', outputLanguage, 'with template:', template?.name || 'default');

    try {
      // Determine if meeting is in the future or past
      const now = new Date();
      const meetingTime = meetingInfo?.startTime ? new Date(meetingInfo.startTime) : null;
      const isFutureMeeting = meetingTime && meetingTime > now;
      const meetingStatus = isFutureMeeting ? 'UPCOMING (not yet started)' : 'COMPLETED';
      
      // Build meeting context from calendar info
      const meetingContext = meetingInfo ? `
Meeting Context:
- Title: ${meetingInfo.title || meetingTitle}
- Scheduled: ${meetingTime ? meetingTime.toLocaleString() : 'Unknown'}
- Status: ${meetingStatus}
- Provider: ${meetingInfo.provider || 'Unknown'}
` : '';

      // Build template sections prompt
      let templatePrompt = '';
      let sectionsFormat = '';
      
      if (template && template.sections && template.sections.length > 0) {
        templatePrompt = `\n\nTEMPLATE: "${template.name}"`;
        if (template.description) {
          templatePrompt += `\nTemplate Purpose: ${template.description}`;
        }
        templatePrompt += `\n\nREQUIRED SECTIONS (follow this structure exactly):`;
        
        template.sections.forEach((section: any, i: number) => {
          templatePrompt += `\n${i + 1}. "${section.title}" - ${section.instructions}`;
        });
        
        // Build dynamic JSON format based on template sections
        const sectionKeys = template.sections.map((s: any) => 
          `"${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}": "Content for ${s.title}"`
        );
        sectionsFormat = `,\n  "sections": {\n    ${sectionKeys.join(',\n    ')}\n  }`;
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are an expert executive assistant with 15+ years of experience. You distill messy, non-linear conversations (meetings, calls, interviews, show segments, etc.) into clear, organized notes that preserve intent without adding anything that wasn't explicitly said.

OUTPUT LANGUAGE: Write EVERYTHING in ${this.getLanguageName(outputLanguage)}. This includes all section headers, content, bullet points, and the summary field.
${templatePrompt}

REQUIRED SECTIONS:
${template && template.sections && template.sections.length > 0 ? 
`YOU MUST USE ALL THE TEMPLATE SECTIONS SPECIFIED ABOVE as ## headers (these are REQUIRED - always include them all). The "enhancedNotes" field MUST contain markdown with those section headers (## Section Name) - TRANSLATED to ${this.getLanguageName(outputLanguage)}. Do NOT use generic sections like "Summary", "Key Points" - use the TEMPLATE sections but translate them.` : 
`Use these sections in the markdown notes (in this order), translated to ${this.getLanguageName(outputLanguage)}:
1) Summary
2) Key Points (grouped thematically)
3) Action Items
4) Decisions`}

⛔ ANTI-HALLUCINATION RULES (CRITICAL — NEVER VIOLATE):
- ONLY include information explicitly stated in the transcript or the user's raw notes.
- DO NOT infer motivations, causes, impacts, or "what they meant" unless it's explicitly stated.
- DO NOT create action items unless someone explicitly committed to doing something.
- DO NOT create decisions unless a decision was explicitly made/announced.
- If uncertain, omit it. When in doubt, leave it out.
- If a section would be empty, write "Not discussed" or "No items".

HANDLING UNCLEAR / LOW-QUALITY TRANSCRIPTS (CRITICAL):
- If any passage is garbled, incomplete, contradictory, or unintelligible, do NOT "smooth it over."
- Instead, add a short "Unclear / Needs Verification" bullet under the most relevant theme, quoting or paraphrasing only what is readable.
- Do not convert unclear audio into confident conclusions.
- If names/terms are uncertain, mark as "[unclear]" rather than guessing.

CLEANUP (STYLE, NOT MEANING):
- Remove filler words ("um," "uh," "like," "you know," "I mean," "basically," etc.), stutters, and false starts.
- Convert spoken language into concise written language WITHOUT changing meaning.
- Preserve tone where it matters (e.g., emotional reactions) but do not embellish.

NAME & TERM NORMALIZATION (SAFE MODE):
- Use consistent spelling for names/terms only when the transcript clearly supports it.
- If spelling is uncertain or the transcript conflicts, use the most common form seen OR "[unclear]".

COMPREHENSIVE COVERAGE:
- Capture ALL substantive points, not just highlights.
- Include meaningful questions, responses, concerns, and commitments.
- Do not add interpretations or "context" that isn't present.

THEMATIC ORGANIZATION (NON-CHRONOLOGICAL):
- Identify 3–7 themes from the conversation.
- Each discussion point should appear exactly once under the best-fitting theme.
- Do NOT write a chronological play-by-play; synthesize into themes.
- If urgency/risk is explicitly stated, place it near the top.

TAIL CHECK:
- Review the last ~30% of the transcript carefully so late points aren't missed.

CRITICAL - USER'S PERSONAL NOTES:
- The "User's Personal Notes" are reminders/details typed by the user - NOT spoken in the conversation.
- You MUST include ALL user notes in relevant sections.
- These are HIGH PRIORITY.
- Fix typos and abbreviations in user notes.
- NEVER ignore user's personal notes.

FORMATTING:
- Use ## for section headers
- Use **bold** for important terms, names, decisions, and technical terms
- Use bullet points (-) with sub-bullets for details (indent with 2 spaces)
- Use ### sub-headers within sections to organize by theme when helpful

OUTPUT FORMAT (JSON):
Return valid JSON only:
{
  "summary": "2–3 sentence summary grounded strictly in the transcript",
  "enhancedNotes": "Markdown notes with ## section headers and themed bullets. Include 'Not discussed' or 'No items' for empty sections."
}`,
            },
            {
              role: 'user',
              content: `Conversation Context: ${meetingTitle}${meetingContext ? `\n${meetingContext}` : ''}

Target Language: ${this.getLanguageName(outputLanguage)}

USER'S PERSONAL NOTES (typed by user - NOT spoken):
${rawNotes || '(No personal notes taken)'}

TRANSCRIPT:
${transcript}

Generate notes in JSON format:`,
            },
          ],
          temperature: 0.5,
          max_tokens: 5000,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const error: any = await response.json();
        console.error('[OpenAI] API error:', error);
        throw new Error(error.error?.message || 'API request failed');
      }

      const data: any = await response.json();
      const usage = data.usage;
      console.log(`[OpenAI] Enhanced notes tokens - Input: ${usage?.prompt_tokens}, Output: ${usage?.completion_tokens}`);

      const content = data.choices[0]?.message?.content;
      const result = JSON.parse(content);
      
      // Add template ID to result if template was used
      if (template && template.id) {
        result.templateId = template.id;
      }
      
      console.log('[OpenAI] Enhanced notes generated successfully');
      return result;

    } catch (error: any) {
      console.error('[OpenAI] Failed to generate enhanced notes:', error);
      return null;
    }
  }

  /**
   * Ask a question about the meeting (transcript + notes)
   */
  async askQuestion(
    question: string,
    transcript: string,
    notes: string,
    meetingTitle: string
  ): Promise<string | null> {
    if (!this.apiKey) {
      console.log('[OpenAI] No API key configured for Q&A');
      return null;
    }

    console.log('[OpenAI] Asking question about meeting...');

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // Fast and cost-effective for Q&A
          messages: [
            {
              role: 'system',
              content: `You are a helpful AI assistant that answers questions about meeting content.
You have access to the meeting transcript and any notes taken during the meeting.

FORMATTING - Use rich markdown for clear, scannable responses:
- Use **bold** for key terms and emphasis
- Use bullet points (-) for lists
- Use numbered lists (1. 2. 3.) for sequences or steps
- Use > blockquotes for direct quotes from the meeting
- Keep paragraphs short (2-3 sentences max)
- Use headers (##) if the answer has multiple sections

Be concise but thorough. If the information isn't in the provided context, clearly say so.`,
            },
            {
              role: 'user',
              content: `Meeting: ${meetingTitle}

TRANSCRIPT:
${transcript || '(No transcript available)'}

NOTES:
${notes || '(No notes taken)'}

---

QUESTION: ${question}

Please answer based on the meeting content above:`,
            },
          ],
          temperature: 0.3,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const errorData: any = await response.json();
        throw new Error(`API error: ${response.status} - ${errorData.error?.message || 'Unknown'}`);
      }

      const data: any = await response.json();
      const answer = data.choices[0]?.message?.content;
      
      console.log('[OpenAI] Q&A answer generated');
      return answer;

    } catch (error: any) {
      console.error('[OpenAI] Q&A failed:', error);
      throw error;
    }
  }
  
  /**
   * Suggest a folder for a note based on content and folder descriptions
   * Returns folder ID if strong match, null otherwise
   */
  async suggestFolder(
    noteContent: string,
    meetingTitle: string,
    folders: Array<{ id: string; name: string; description: string }>
  ): Promise<{ folderId: string; confidence: 'high' | 'medium' | 'low'; reason: string } | null> {
    if (!this.apiKey || !folders.length) {
      console.log('[OpenAI] No API key or no folders for suggestion');
      return null;
    }

    // Use all folders - match on name AND description
    console.log('[OpenAI] Suggesting folder from', folders.length, 'candidates...');

    try {
      const folderList = folders.map((f, i) => {
        const desc = f.description && f.description.trim().length > 0 
          ? f.description 
          : '(no description - match based on folder name)';
        return `${i + 1}. "${f.name}" (ID: ${f.id})\n   Description: ${desc}`;
      }).join('\n\n');

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a folder classification assistant. Given meeting notes content and a list of folders, determine if the content strongly matches any folder.

MATCHING CRITERIA:
- Match based on BOTH folder NAME and DESCRIPTION
- Folder names often indicate the type of meeting (e.g., "Sales Calls", "1:1s", "Engineering Standup")
- If a folder has no description, match purely on the folder name

CRITICAL RULES:
1. You MUST ONLY return a folderId that EXACTLY matches one of the IDs provided in the folder list below
2. Do NOT invent or create new folder IDs - only use IDs from the provided list
3. If no folder is a good fit, return folderId as null
4. Suggest a folder if there's a reasonable match based on folder name OR description

Output JSON format:
{
  "folderId": "exact-folder-id-from-list" or null,
  "confidence": "high" | "medium" | "low",
  "reason": "brief explanation"
}

- "high" confidence: Content clearly matches the folder's name/purpose (70%+ sure)
- "medium" confidence: Content somewhat matches (50-70% sure)  
- "low" confidence: Weak match, might fit (30-50% sure)

If confidence would be below "low", return folderId as null instead.`,
            },
            {
              role: 'user',
              content: `MEETING TITLE: ${meetingTitle}

MEETING CONTENT (summary/notes):
${noteContent.substring(0, 2000)}

AVAILABLE FOLDERS:
${folderList}

Which folder (if any) is a strong match for this meeting?`,
            },
          ],
          temperature: 0.2,
          max_tokens: 200,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        console.error('[OpenAI] Folder suggestion failed:', response.status);
        return null;
      }

      const data: any = await response.json();
      const content = data.choices[0]?.message?.content;
      const result = JSON.parse(content);

      if (result.folderId && (result.confidence === 'high' || result.confidence === 'medium')) {
        console.log('[OpenAI] Suggested folder:', result.folderId, 'with', result.confidence, 'confidence');
        console.log('[OpenAI] Reason:', result.reason);
        return { folderId: result.folderId, confidence: result.confidence, reason: result.reason || '' };
      }

      console.log('[OpenAI] No strong folder match found');
      return null;
    } catch (error) {
      console.error('[OpenAI] Folder suggestion error:', error);
      return null;
    }
  }

  // Suggest which template best fits the meeting content
  async suggestTemplate(
    rawNotes: string,
    transcript: string,
    meetingTitle: string,
    templates: Array<{ id: string; name: string; description: string }>
  ): Promise<{ templateId: string; confidence: string; reason: string } | null> {
    if (!this.apiKey || templates.length === 0) {
      return null;
    }

    console.log('[OpenAI] Suggesting template from', templates.length, 'options...');

    try {
      const templateList = templates.map((t, i) => 
        `${i + 1}. "${t.name}" (ID: ${t.id}) - ${t.description || 'General meeting notes'}`
      ).join('\n');

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a meeting classifier. Given meeting content and a list of note templates, suggest which template would produce the best notes for this meeting.

CRITICAL RULES:
1. You MUST ONLY return a templateId that EXACTLY matches one of the IDs provided in the template list below
2. Do NOT invent or create new template IDs - only use IDs from the provided list
3. If no template is a strong match, return templateId as null
4. Only suggest a template if it's a STRONG match

Respond in JSON:
{
  "templateId": "exact-template-id-from-list" or null,
  "confidence": "high" | "medium" | "low",
  "reason": "brief explanation"
}

Return null for templateId if confidence would be "low".`,
            },
            {
              role: 'user',
              content: `MEETING: ${meetingTitle}

USER NOTES:
${rawNotes.substring(0, 500)}

TRANSCRIPT EXCERPT:
${transcript.substring(0, 1500)}

AVAILABLE TEMPLATES:
${templateList}

Which template best fits this meeting?`,
            },
          ],
          temperature: 0.2,
          max_tokens: 150,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        console.error('[OpenAI] Template suggestion failed:', response.status);
        return null;
      }

      const data: any = await response.json();
      const content = data.choices[0]?.message?.content;
      const result = JSON.parse(content);

      if (result.templateId && (result.confidence === 'high' || result.confidence === 'medium')) {
        console.log('[OpenAI] Suggested template:', result.templateId, 'with', result.confidence, 'confidence');
        return { templateId: result.templateId, confidence: result.confidence, reason: result.reason || '' };
      }

      console.log('[OpenAI] No strong template match found');
      return null;
    } catch (error) {
      console.error('[OpenAI] Template suggestion error:', error);
      return null;
    }
  }

  /**
   * Generate a meeting title from transcript
   * Used when no calendar event or meaningful title is available
   */
  async generateMeetingTitle(transcript: string[], outputLanguage: string = 'en'): Promise<string | null> {
    if (!this.apiKey) {
      console.log('[OpenAI] No API key for title generation');
      return null;
    }
    
    // Need at least some transcript content
    const transcriptText = transcript.slice(0, 50).join(' '); // First 50 segments
    if (transcriptText.length < 50) {
      console.log('[OpenAI] Not enough transcript for title generation');
      return null;
    }
    
    const langName = this.getLanguageName(outputLanguage);
    console.log('[OpenAI] Generating meeting title from transcript in', langName);
    
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Generate a concise, descriptive meeting title (3-7 words) based on the transcript content.
The title should capture the main topic or purpose of the meeting.
IMPORTANT: Generate the title in ${langName}. Do NOT use English unless ${langName} is English.
Return ONLY the title text, NO quotes around it, no explanation.

Examples (if language is English):
- Weekly Team Standup
- Product Launch Planning
- 1:1 with Sarah

Examples (if language is Hindi):
- साप्ताहिक टीम मीटिंग
- उत्पाद लॉन्च योजना
- सारा के साथ बैठक`,
            },
            {
              role: 'user',
              content: `Generate a meeting title in ${langName} for this conversation:\n\n${transcriptText.substring(0, 2000)}`,
            },
          ],
          temperature: 0.5,
          max_tokens: 50,
        }),
      });

      if (!response.ok) {
        console.error('[OpenAI] Title generation failed:', response.status);
        return null;
      }

      const data: any = await response.json();
      const title = data.choices[0]?.message?.content?.trim();
      
      if (title && title.length > 0 && title.length < 100) {
        console.log('[OpenAI] Generated title:', title);
        return title;
      }
      
      return null;
    } catch (error) {
      console.error('[OpenAI] Title generation error:', error);
      return null;
    }
  }

}

