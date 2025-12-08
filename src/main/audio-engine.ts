import path from 'path';
import { app } from 'electron';
import fs from 'fs';

export interface NativeAudioModule {
  startAudioCapture(pid: number, options?: AudioCaptureOptions): Promise<void>;
  stopAudioCapture(): Promise<string>; // Returns path to recorded file
  getAudioLevel(): number;
  isCapturing(): boolean;
  getCaptureDuration(): number;
}

export interface AudioCaptureOptions {
  sampleRate?: number;
  channels?: number;
  outputPath?: string;
  includeMicrophone?: boolean;
}

export class AudioEngine {
  private native: NativeAudioModule;
  private recording = false;
  private recordingStartTime: number | null = null;
  private currentOutputPath: string | null = null;

  constructor(native: NativeAudioModule) {
    this.native = native;
  }

  async startRecording(pid: number, provider: string): Promise<void> {
    console.log('[AudioEngine] startRecording called, pid:', pid, 'provider:', provider);
    
    if (this.recording) {
      throw new Error('Already recording');
    }

    // Create recordings directory
    const recordingsDir = path.join(app.getPath('userData'), 'recordings');
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${provider}-${timestamp}.wav`;
    this.currentOutputPath = path.join(recordingsDir, filename);

    console.log('[AudioEngine] Calling native.startAudioCapture with path:', this.currentOutputPath);
    
    try {
      await this.native.startAudioCapture(pid, {
        sampleRate: 48000,
        channels: 2,
        outputPath: this.currentOutputPath,
        includeMicrophone: true,
      });
      console.log('[AudioEngine] ✅ Native audio capture started successfully');
    } catch (err) {
      console.error('[AudioEngine] ❌ Failed to start native audio capture:', err);
      throw err;
    }

    this.recording = true;
    this.recordingStartTime = Date.now();
  }

  async stopRecording(): Promise<string | null> {
    if (!this.recording) {
      return null;
    }

    const outputPath = await this.native.stopAudioCapture();
    this.recording = false;
    this.recordingStartTime = null;
    
    return outputPath || this.currentOutputPath;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getDuration(): number {
    if (!this.recordingStartTime) return 0;
    return Date.now() - this.recordingStartTime;
  }

  getAudioLevel(): number {
    if (!this.recording) return 0;
    try {
      return this.native.getAudioLevel();
    } catch {
      return 0;
    }
  }
}







