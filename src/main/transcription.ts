import { safeStorage, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';

const CONFIG_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  'Library',
  'Application Support',
  'ghost-meeting-sdk',
  'config.json'
);

interface TranscriptionConfig {
  deepgramApiKey?: string;  // Encrypted (base64)
}

export interface LanguageSettings {
  transcriptionLang: string;
  aiNotesLang: string;
  autoDetect: boolean;
}

export interface TranscriptSegment {
  text: string;
  speaker: number | null;  // Speaker ID from diarization (0, 1, 2, etc.)
  channel: number;         // Always 0 for mono
  timestamp: number;
  isYou: boolean;          // Determined by diarization learning
  isFinal?: boolean;       // true if Deepgram has finalized this segment
  speechFinal?: boolean;   // true if end of utterance detected
}

/**
 * TranscriptionService
 * 
 * Instead of relying on stereo channel separation (which doesn't work well),
 * we use MONO audio with DIARIZATION:
 * 
 * 1. Mix system audio + mic into a single MONO stream
 * 2. Send to Deepgram with diarize=true
 * 3. Deepgram identifies speakers by voice characteristics
 * 4. We learn which speaker ID is "You" based on mic-dominant segments
 * 
 * This is more reliable because:
 * - Works even if mic picks up speaker audio
 * - Works for recorded meetings where all audio is from one source
 * - Diarization uses ML to identify unique voices
 */
export class TranscriptionService {
  private apiKey: string | null = null;
  private language: string = 'en';
  private autoDetect: boolean = false;
  
  // Deepgram WebSocket
  private ws: WebSocket | null = null;
  private isStreaming: boolean = false;
  private audioPollingInterval: ReturnType<typeof setInterval> | null = null;
  
  // Native module reference (will be set externally)
  private nativeModule: any = null;
  
  // Callback for sending transcripts to renderer
  private onTranscript: ((segment: TranscriptSegment) => void) | null = null;
  
  // Speaker tracking for diarization (supplementary to channel-based detection)

  constructor() {
    this.loadApiKey();
  }
  
  public setNativeModule(nativeModule: any): void {
    this.nativeModule = nativeModule;
  }
  
  public setLanguage(lang: string, autoDetect: boolean = false): void {
    this.language = lang;
    this.autoDetect = autoDetect;
    console.log(`[Transcription] Language set to: ${lang}, auto-detect: ${autoDetect}`);
  }
  
  public getLanguage(): string {
    return this.language;
  }
  
  public isAutoDetect(): boolean {
    return this.autoDetect;
  }
  
  public setOnTranscript(callback: (segment: TranscriptSegment) => void): void {
    this.onTranscript = callback;
  }

  private loadApiKey(): void {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const config: TranscriptionConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        if (config.deepgramApiKey && safeStorage.isEncryptionAvailable()) {
          const encrypted = Buffer.from(config.deepgramApiKey, 'base64');
          this.apiKey = safeStorage.decryptString(encrypted);
          console.log('[Transcription] API key loaded from secure storage');
        }
      }
    } catch (e) {
      console.error('[Transcription] Failed to load API key:', e);
    }
  }

  public saveApiKey(apiKey: string): boolean {
    try {
      // Ensure directory exists
      const dir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Encrypt and save
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(apiKey);
        const config: TranscriptionConfig = { 
          deepgramApiKey: encrypted.toString('base64')
        };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        this.apiKey = apiKey;
        console.log('[Transcription] API key saved securely');
        return true;
      } else {
        console.error('[Transcription] Encryption not available');
        return false;
      }
    } catch (e) {
      console.error('[Transcription] Failed to save API key:', e);
      return false;
    }
  }

  public hasApiKey(): boolean {
    return !!this.apiKey;
  }

  public getApiKey(): string | null {
    return this.apiKey;
  }

  public clearApiKey(): void {
    this.apiKey = null;
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const config: TranscriptionConfig = {};
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log('[Transcription] API key cleared');
      }
    } catch (e) {
      console.error('[Transcription] Failed to clear API key:', e);
    }
  }
  
  /**
   * Start streaming audio to Deepgram
   * Uses MONO audio with diarization
   */
  public startStreaming(): boolean {
    if (!this.apiKey) {
      console.error('[Transcription] No API key configured');
      return false;
    }
    
    if (!this.nativeModule) {
      console.error('[Transcription] Native module not set');
      return false;
    }
    
    if (this.isStreaming) {
      console.log('[Transcription] Already streaming');
      return true;
    }
    
    // Reset speaker learning for new session
    this.resetSpeakerLearning();
    
    console.log('[Transcription] Starting Deepgram streaming (MONO + diarization)...');
    
    // Use Nova-3 for auto-detect (better multilingual), Nova-2 for fixed language
    const modelToUse = this.autoDetect ? 'nova-3' : 'nova-2';
    
    // STEREO audio with multichannel + diarization for best results
    // Channel 0 (Left) = System audio = "Them"
    // Channel 1 (Right) = Mic audio = "You"
    // Diarization provides additional speaker identification
    const params = new URLSearchParams({
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '2',              // STEREO audio
      multichannel: 'true',       // Process each channel separately
      model: modelToUse,
      punctuate: 'true',
      interim_results: 'true',
      smart_format: 'true',
      utterance_end_ms: '1000',   // Detect end of utterance after 1s silence
      endpointing: '300',         // Faster endpoint detection (300ms)
      diarize: 'true',            // Also use diarization for voice fingerprinting
    });
    
    // Language settings
    if (this.autoDetect) {
      params.set('language', 'multi');
      console.log('[Transcription] Auto-detect enabled: language=multi (nova-3 multilingual)');
    } else if (this.language) {
      params.set('language', this.language);
      console.log('[Transcription] Fixed language:', this.language);
    }
    
    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    console.log('[Transcription] Deepgram URL:', wsUrl);
    
    try {
      this.ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      });
      
      this.ws.on('open', () => {
        console.log('[Transcription] ✅ Connected to Deepgram (STEREO + multichannel + diarization)');
        console.log('[Transcription] Channel 0 = System (Them), Channel 1 = Mic (You) + diarization for voice ID');
        this.isStreaming = true;
        this.startAudioPolling();
      });
      
      this.ws.on('message', (data: Buffer) => {
        this.handleDeepgramMessage(data);
      });
      
      this.ws.on('error', (err) => {
        console.error('[Transcription] WebSocket error:', err);
      });
      
      this.ws.on('close', (code, reason) => {
        console.log(`[Transcription] WebSocket closed: ${code} - ${reason}`);
        this.isStreaming = false;
        this.stopAudioPolling();
      });
      
      return true;
    } catch (err) {
      console.error('[Transcription] Failed to connect:', err);
      return false;
    }
  }
  
  /**
   * Stop streaming audio to Deepgram
   */
  public stopStreaming(): void {
    console.log('[Transcription] Stopping streaming...');
    this.stopAudioPolling();
    
    if (this.ws) {
      // Send close frame
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }
    
    this.isStreaming = false;
  }
  
  /**
   * Check if currently streaming
   */
  public isCurrentlyStreaming(): boolean {
    return this.isStreaming;
  }
  
  /**
   * Start polling native module for audio chunks
   */
  private startAudioPolling(): void {
    if (this.audioPollingInterval) {
      return;
    }
    
    console.log('[Transcription] Starting audio polling (STEREO)...');
    let chunkCount = 0;
    
    this.audioPollingInterval = setInterval(() => {
      if (!this.isStreaming || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      
      try {
        // Get audio chunks from native module (stereo: L=system, R=mic)
        const chunks = this.nativeModule.getAudioChunks();
        
        for (const chunk of chunks) {
          // Send stereo chunks directly - Deepgram handles multichannel
          this.ws.send(chunk);
          chunkCount++;
        }
        
        // Log occasionally
        if (chunkCount > 0 && chunkCount % 50 === 0) {
          console.log(`[Transcription] Sent ${chunkCount} stereo audio chunks to Deepgram`);
        }
      } catch (err) {
        console.error('[Transcription] Error getting audio chunks:', err);
      }
    }, 100); // Poll every 100ms
  }
  
  /**
   * Stop polling for audio chunks
   */
  private stopAudioPolling(): void {
    if (this.audioPollingInterval) {
      clearInterval(this.audioPollingInterval);
      this.audioPollingInterval = null;
      console.log('[Transcription] Stopped audio polling');
    }
  }
  
  // Track unique speakers seen from diarization
  private seenSpeakers: Set<number> = new Set();
  
  /**
   * Handle incoming message from Deepgram
   * Uses DIARIZATION as primary speaker identification (voice fingerprinting)
   * Channel is secondary - helps identify which audio source
   */
  private handleDeepgramMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle transcription results
      if (message.type === 'Results' && message.channel) {
        // Multichannel: channel_index tells us which audio source
        const channelIndex = Array.isArray(message.channel_index) 
          ? message.channel_index[0] 
          : 0;
        
        const alternatives = message.channel?.alternatives;
        
        if (alternatives && alternatives.length > 0) {
          const transcript = alternatives[0].transcript;
          const words = alternatives[0].words || [];
          const isFinal = message.is_final;
          const speechFinal = message.speech_final;
          
          // Skip empty transcripts
          if (!transcript || !transcript.trim()) {
            return;
          }
          
          // Get diarization speaker ID if available
          let speakerId: number | null = null;
          if (words.length > 0 && words[0].speaker !== undefined) {
            speakerId = words[0].speaker;
            
            // Track unique speakers
            if (isFinal && speakerId !== null && !this.seenSpeakers.has(speakerId)) {
              this.seenSpeakers.add(speakerId);
              console.log(`[Transcription] 🎤 New speaker detected: Speaker ${speakerId} (total: ${this.seenSpeakers.size} speakers)`);
            }
          }
          
          // Use DIARIZATION speaker ID for isYou determination if we have multiple speakers
          // Otherwise fall back to channel-based detection
          let isYou: boolean;
          if (speakerId !== null && this.seenSpeakers.size >= 2) {
            // Multiple speakers detected - use diarization
            // Speaker 0 is typically the first/primary speaker (often "you" since you start recording)
            isYou = speakerId === 0;
          } else {
            // Fall back to channel-based detection
            // Channel 1 = Mic (You), Channel 0 = System (Them)
            isYou = channelIndex === 1;
          }
          
          const segment: TranscriptSegment = {
            text: transcript.trim(),
            speaker: speakerId,
            channel: channelIndex,
            timestamp: Date.now(),
            isYou: isYou,
            isFinal: isFinal,
            speechFinal: speechFinal || false,
          };
          
          // Build detailed log label
          const speakerLabel = isYou ? 'YOU' : 'THEM';
          const channelLabel = `CH${channelIndex}`;
          const diarizeLabel = speakerId !== null ? `[S${speakerId}]` : '[no-diarize]';
          const finalLabel = isFinal ? '✓' : '...';
          console.log(`[Transcription] ${speakerLabel} ${channelLabel} ${diarizeLabel} [${finalLabel}]: ${transcript.substring(0, 50)}`);
          
          // Forward to renderer
          if (this.onTranscript) {
            this.onTranscript(segment);
          }
        }
      }
    } catch (err) {
      // Ignore parse errors for non-JSON messages
    }
  }
  
  /**
   * Reset state when starting new transcription
   */
  private resetSpeakerLearning(): void {
    this.seenSpeakers.clear();
    console.log('[Transcription] Session reset - speaker tracking cleared');
  }
}
