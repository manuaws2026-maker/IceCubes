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
  speaker: number | null;  // Speaker ID from diarization within the channel
  channel: number;         // 0 = system audio (others), 1 = mic (you)
  timestamp: number;
  isYou: boolean;          // true if from mic channel (channel 1)
}

/**
 * TranscriptionService manages:
 * 1. Secure storage of the Deepgram API key
 * 2. WebSocket connection to Deepgram with MULTICHANNEL audio
 * 3. Streaming STEREO audio: Left=System (others), Right=Mic (you)
 * 4. Forwarding transcripts to the renderer with channel info
 * 
 * MULTICHANNEL APPROACH:
 * - Channel 0 (Left) = System audio - other meeting participants
 * - Channel 1 (Right) = Microphone - your voice (labeled as "You")
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
   * Uses STEREO audio with multichannel processing:
   * - Channel 0 (Left) = System audio (other participants)
   * - Channel 1 (Right) = Microphone (you)
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
    
    console.log('[Transcription] Starting Deepgram streaming (STEREO multichannel - Me vs Them)...');
    
    // Build Deepgram URL - STEREO multichannel for Me vs Them separation
    // Channel 0 (Left) = System audio = "Them" (other participants)
    // Channel 1 (Right) = Microphone = "You" (your voice)
    // Diarization disabled - we use channel separation instead
    // Use Nova-3 for auto-detect (better multilingual), Nova-2 for fixed language
    const modelToUse = this.autoDetect ? 'nova-3' : 'nova-2';
    
    const params = new URLSearchParams({
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '2',              // STEREO audio
      multichannel: 'true',       // Process each channel separately
      model: modelToUse,
      punctuate: 'true',
      interim_results: 'true',
      smart_format: 'true',
      // No diarize - we rely on channel separation for Me vs Them
    });
    
    // Language settings for live streaming
    // Nova-3 has built-in multilingual support - just use language=multi
    if (this.autoDetect) {
      // Nova-3 with language=multi for best multilingual detection
      params.set('language', 'multi');
      console.log('[Transcription] Auto-detect enabled: language=multi (nova-3 multilingual)');
    } else if (this.language) {
      // Use specific language code with nova-2
      params.set('language', this.language);
      console.log('[Transcription] Fixed language:', this.language);
    }
    
    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    console.log('[Transcription] Deepgram URL:', wsUrl);
    console.log('[Transcription] Language param:', params.get('language'), '| autoDetect:', this.autoDetect);
    
    try {
      this.ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      });
      
      this.ws.on('open', () => {
        console.log('[Transcription] Connected to Deepgram (STEREO multichannel)');
        console.log('[Transcription] Channel 0 = System audio (others), Channel 1 = Mic (you)');
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
    
    console.log('[Transcription] Starting audio polling...');
    let chunkCount = 0;
    
    this.audioPollingInterval = setInterval(() => {
      if (!this.isStreaming || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      
      try {
        // Get audio chunks from native module
        const chunks = this.nativeModule.getAudioChunks();
        
        for (const chunk of chunks) {
          // chunk is a Buffer containing stereo 16-bit PCM
          this.ws.send(chunk);
          chunkCount++;
        }
        
        // Log occasionally
        if (chunkCount > 0 && chunkCount % 50 === 0) {
          console.log(`[Transcription] Sent ${chunkCount} audio chunks to Deepgram`);
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
  
  /**
   * Handle incoming message from Deepgram
   * Multichannel format: channel_index tells us which channel
   * Channel 0 (Left) = System audio = "Them"
   * Channel 1 (Right) = Microphone = "You"
   */
  private handleDeepgramMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle transcription results
      if (message.type === 'Results' && message.channel) {
        // Multichannel: channel_index is [channel_number, total_channels]
        const channelIndex = Array.isArray(message.channel_index) 
          ? message.channel_index[0] 
          : 0;
        
        const alternatives = message.channel?.alternatives;
        
        if (alternatives && alternatives.length > 0) {
          const transcript = alternatives[0].transcript;
          const isFinal = message.is_final;
          
          // Only process final results to avoid duplicates
          if (!isFinal || !transcript || !transcript.trim()) {
            return;
          }
          
          // Channel 0 = System audio (Them), Channel 1 = Mic (You)
          const isYou = channelIndex === 1;
          
          const segment: TranscriptSegment = {
            text: transcript.trim(),
            speaker: isYou ? -1 : 0, // -1 for You, 0 for Them
            channel: channelIndex,
            timestamp: Date.now(),
            isYou: isYou,
          };
          
          const label = isYou ? 'YOU' : 'THEM';
          console.log(`[Transcription] [${label}]: ${transcript.substring(0, 60)}...`);
          
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
}
