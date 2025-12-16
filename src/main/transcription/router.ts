import { TranscriptionService } from '../transcription';
import { TranscriptSegment, TranscriptionEngine } from './types';
import Store from 'electron-store';

const store = new Store();

/**
 * Transcription Router - Manages switching between Deepgram and Parakeet (Rust)
 * 
 * Parakeet is implemented in the Rust native module (src-native/)
 * This router coordinates between the two engines.
 */
export class TranscriptionRouter {
  private deepgramEngine: TranscriptionService;
  private currentEngine: TranscriptionEngine;
  private nativeModule: any = null;
  private onTranscript: ((segment: TranscriptSegment) => void) | null = null;

  // Parakeet live transcription state
  private parakeetAudioBuffer: Buffer[] = [];
  private parakeetPollingInterval: ReturnType<typeof setInterval> | null = null;
  private parakeetTranscribeInterval: ReturnType<typeof setInterval> | null = null;
  private isParakeetStreaming: boolean = false;
  private parakeetInitialized: boolean = false;
  private lastTranscriptText: string = '';
  private recordingStartTime: number = 0;  // Track when recording started
  private cumulativeAudioTime: number = 0;  // Track cumulative audio processed (seconds)
  private isPaused: boolean = false;  // Track pause state

  constructor() {
    this.deepgramEngine = new TranscriptionService();
    
    // Load saved engine preference (default to deepgram until Parakeet is ready)
    this.currentEngine = (store.get('transcriptionEngine') as TranscriptionEngine) || 'deepgram';
    
    console.log('[TranscriptionRouter] Initialized with engine:', this.currentEngine);
  }

  /**
   * Set the transcription engine to use
   */
  setEngine(engine: TranscriptionEngine): void {
    console.log('[TranscriptionRouter] Switching to engine:', engine);
    this.currentEngine = engine;
    store.set('transcriptionEngine', engine);
  }

  /**
   * Get current engine
   */
  getEngine(): TranscriptionEngine {
    return this.currentEngine;
  }

  /**
   * Set native module reference (includes Rust Parakeet)
   */
  setNativeModule(nativeModule: any): void {
    this.nativeModule = nativeModule;
    this.deepgramEngine.setNativeModule(nativeModule);
  }

  /**
   * Set transcription callback
   */
  setOnTranscript(callback: (segment: TranscriptSegment) => void): void {
    this.onTranscript = callback;
    this.deepgramEngine.setOnTranscript(callback);
  }

  /**
   * Set language for Deepgram (Parakeet auto-detects)
   */
  setLanguage(lang: string, autoDetect: boolean = false): void {
    if (this.currentEngine === 'deepgram') {
      this.deepgramEngine.setLanguage(lang, autoDetect);
    }
    // Parakeet (Rust) always auto-detects from 25 languages
  }

  /**
   * Start streaming with the current engine
   */
  async startStreaming(): Promise<boolean> {
    // Re-read engine from store to get latest value
    const savedEngine = store.get('transcriptionEngine') as TranscriptionEngine;
    if (savedEngine && savedEngine !== this.currentEngine) {
      console.log(`[TranscriptionRouter] Engine mismatch! Updating from ${this.currentEngine} to ${savedEngine}`);
      this.currentEngine = savedEngine;
    }
    
    console.log(`[TranscriptionRouter] 🎙️ Starting transcription with engine: ${this.currentEngine.toUpperCase()}`);
    
    try {
      if (this.currentEngine === 'parakeet') {
        console.log('[TranscriptionRouter] Using Parakeet (local) for transcription');
        return await this.startParakeetStreaming();
      } else {
        console.log('[TranscriptionRouter] Using Deepgram (cloud) for transcription');
        return this.deepgramEngine.startStreaming();
      }
    } catch (error) {
      console.error('[TranscriptionRouter] Failed to start streaming:', error);
      return false;
    }
  }

  /**
   * Start Parakeet streaming transcription
   * Buffers audio and periodically transcribes it
   */
  private async startParakeetStreaming(): Promise<boolean> {
    if (!this.nativeModule) {
      console.error('[Parakeet] No native module available');
      return false;
    }

    // Check if Parakeet model is downloaded
    const isDownloaded = this.nativeModule.isParakeetDownloaded?.();
    if (!isDownloaded) {
      console.error('[Parakeet] Model not downloaded');
      return false;
    }

    // Initialize Parakeet if not already done
    if (!this.parakeetInitialized) {
      try {
        console.log('[Parakeet] Initializing model...');
        const initResult = this.nativeModule.initParakeet?.();
        if (initResult) {
          this.parakeetInitialized = true;
          console.log('[Parakeet] ✅ Model initialized');
        } else {
          console.error('[Parakeet] Failed to initialize model');
          return false;
        }
      } catch (e) {
        console.error('[Parakeet] Init error:', e);
        return false;
      }
    }

    this.isParakeetStreaming = true;
    this.parakeetAudioBuffer = [];
    this.lastTranscriptText = '';
    this.recordingStartTime = Date.now();
    this.cumulativeAudioTime = 0;

    // Start polling for audio chunks (every 100ms)
    console.log('[Parakeet] Starting audio polling...');
    this.parakeetPollingInterval = setInterval(() => {
      if (!this.isParakeetStreaming || !this.nativeModule) return;
      
      try {
        const chunks = this.nativeModule.getAudioChunks?.();
        if (chunks && chunks.length > 0) {
          for (const chunk of chunks) {
            this.parakeetAudioBuffer.push(chunk);
          }
        }
      } catch (e) {
        // Silently ignore polling errors
      }
    }, 100);

    // Start transcription interval (every 5 seconds for better context)
    // Parakeet works better with longer audio segments
    console.log('[Parakeet] Starting transcription interval (every 5s)...');
    this.parakeetTranscribeInterval = setInterval(async () => {
      await this.transcribeBufferedAudio();
    }, 5000);

    console.log('[Parakeet] ✅ Live transcription started');
    return true;
  }

  /**
   * Transcribe the buffered audio using Parakeet
   */
  private async transcribeBufferedAudio(): Promise<void> {
    if (!this.isParakeetStreaming || !this.nativeModule || this.parakeetAudioBuffer.length === 0 || this.isPaused) {
      return;
    }

    try {
      // Combine all buffered audio into a single buffer
      const combinedBuffer = Buffer.concat(this.parakeetAudioBuffer);
      
      // Clear the buffer for next batch
      this.parakeetAudioBuffer = [];

      // Audio is at 16kHz stereo (2 bytes/sample * 2 channels = 4 bytes/frame)
      // Need at least 1.5 seconds = 24000 frames = 96000 bytes for good context
      if (combinedBuffer.length < 96000) {
        console.log(`[Parakeet] Skipping - only ${(combinedBuffer.length / 1024).toFixed(1)}KB buffered (need at least 96KB / 1.5s)`);
        return;
      }

      console.log(`[Parakeet] Transcribing ${(combinedBuffer.length / 1024).toFixed(1)}KB of audio...`);
      
      // Convert stereo to mono
      const monoBuffer = this.stereoToMono(combinedBuffer);
      
      // Calculate duration of this audio chunk (16kHz, mono, 16-bit = 2 bytes/sample)
      const chunkDurationSeconds = monoBuffer.length / 2 / 16000;
      const chunkStartTime = this.cumulativeAudioTime;
      
      // Update cumulative time for next chunk
      this.cumulativeAudioTime += chunkDurationSeconds;
      
      // Transcribe with timestamps
      const result = this.nativeModule.transcribeAudioBufferWithTimestamps?.(monoBuffer, 16000, 1);
      
      if (result && result.segments && result.segments.length > 0) {
        // Emit each segment with its proper timestamp
        for (const seg of result.segments) {
          if (seg.text && seg.text.trim().length > 0) {
            // Calculate absolute timestamp from recording start
            const absoluteStartTime = chunkStartTime + (seg.startTime || 0);
            
            if (this.onTranscript) {
              const segment: TranscriptSegment = {
                text: seg.text.trim(),
                speaker: null,
                channel: 0,
                isYou: false,
                isFinal: true,
                timestamp: this.recordingStartTime + (absoluteStartTime * 1000),
                // Add formatted time for display
                formattedTime: this.formatTime(absoluteStartTime),
              };
              this.onTranscript(segment);
              console.log(`[Parakeet] [${segment.formattedTime}] "${seg.text.substring(0, 40)}..."`);
            }
          }
        }
      } else if (result && result.fullText && result.fullText.trim().length > 0) {
        // Fallback: emit full text as single segment if no segments returned
        if (result.fullText !== this.lastTranscriptText) {
          this.lastTranscriptText = result.fullText;
          
          if (this.onTranscript) {
            const segment: TranscriptSegment = {
              text: result.fullText,
              speaker: null,
              channel: 0,
              isYou: false,
              isFinal: true,
              timestamp: this.recordingStartTime + (chunkStartTime * 1000),
              formattedTime: this.formatTime(chunkStartTime),
            };
            this.onTranscript(segment);
            console.log(`[Parakeet] [${segment.formattedTime}] "${result.fullText.substring(0, 50)}..."`);
          }
        }
      }
    } catch (e) {
      console.error('[Parakeet] Transcription error:', e);
    }
  }

  /**
   * Format seconds as MM:SS timestamp
   */
  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Convert stereo audio to mono by averaging channels
   */
  private stereoToMono(stereoBuffer: Buffer): Buffer {
    // Stereo 16-bit PCM: [L0_lo, L0_hi, R0_lo, R0_hi, L1_lo, L1_hi, R1_lo, R1_hi, ...]
    // Each sample is 2 bytes, so each stereo frame is 4 bytes
    const numFrames = Math.floor(stereoBuffer.length / 4);
    const monoBuffer = Buffer.alloc(numFrames * 2);
    
    for (let i = 0; i < numFrames; i++) {
      const left = stereoBuffer.readInt16LE(i * 4);
      const right = stereoBuffer.readInt16LE(i * 4 + 2);
      const mono = Math.round((left + right) / 2);
      monoBuffer.writeInt16LE(mono, i * 2);
    }
    
    return monoBuffer;
  }

  /**
   * Stop streaming
   */
  stopStreaming(): void {
    if (this.currentEngine === 'parakeet') {
      this.stopParakeetStreaming();
    } else {
      this.deepgramEngine.stopStreaming();
    }
  }

  /**
   * Stop Parakeet streaming
   */
  private stopParakeetStreaming(): void {
    console.log('[Parakeet] Stopping live transcription...');
    this.isParakeetStreaming = false;
    
    if (this.parakeetPollingInterval) {
      clearInterval(this.parakeetPollingInterval);
      this.parakeetPollingInterval = null;
    }
    
    if (this.parakeetTranscribeInterval) {
      clearInterval(this.parakeetTranscribeInterval);
      this.parakeetTranscribeInterval = null;
    }
    
    // Do one final transcription of remaining buffer
    if (this.parakeetAudioBuffer.length > 0) {
      this.transcribeBufferedAudio().catch(() => {});
    }
    
    this.parakeetAudioBuffer = [];
    console.log('[Parakeet] Live transcription stopped');
  }

  /**
   * Pause streaming - stops processing but keeps state
   */
  pauseStreaming(): void {
    console.log('[TranscriptionRouter] Pausing streaming...');
    this.isPaused = true;
    
    if (this.currentEngine === 'parakeet') {
      // Stop intervals but keep buffer
      if (this.parakeetTranscribeInterval) {
        clearInterval(this.parakeetTranscribeInterval);
        this.parakeetTranscribeInterval = null;
      }
      // Keep polling for audio but don't transcribe
    } else {
      // Deepgram: pause by clearing interval (if any)
      this.deepgramEngine.pauseStreaming?.();
    }
    
    console.log('[TranscriptionRouter] ⏸️ Streaming paused');
  }

  /**
   * Resume streaming
   */
  resumeStreaming(): void {
    if (!this.isPaused) return;
    
    console.log('[TranscriptionRouter] Resuming streaming...');
    this.isPaused = false;
    
    if (this.currentEngine === 'parakeet' && this.isParakeetStreaming) {
      // Discard any audio buffered during pause
      console.log(`[TranscriptionRouter] Discarding ${this.parakeetAudioBuffer.length} parakeet audio chunks buffered during pause`);
      this.parakeetAudioBuffer = [];
      
      // Restart transcription interval
      if (!this.parakeetTranscribeInterval) {
        this.parakeetTranscribeInterval = setInterval(async () => {
          await this.transcribeBufferedAudio();
        }, 5000);
      }
    } else {
      this.deepgramEngine.resumeStreaming?.();
    }
    
    console.log('[TranscriptionRouter] ▶️ Streaming resumed');
  }

  /**
   * Check if currently streaming
   */
  isCurrentlyStreaming(): boolean {
    if (this.currentEngine === 'parakeet') {
      return this.isParakeetStreaming;
    }
    return this.deepgramEngine.isCurrentlyStreaming();
  }

  /**
   * Get Deepgram service (for API key management, etc.)
   */
  getDeepgramService(): TranscriptionService {
    return this.deepgramEngine;
  }

  /**
   * Check if Parakeet (Rust) is ready to use
   */
  async isParakeetReady(): Promise<boolean> {
    try {
      return this.nativeModule?.isParakeetReady?.() ?? false;
    } catch (e) {
      return false;
    }
  }
}

// Singleton instance
let router: TranscriptionRouter | null = null;

export function getTranscriptionRouter(): TranscriptionRouter {
  if (!router) {
    router = new TranscriptionRouter();
  }
  return router;
}
