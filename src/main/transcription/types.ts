export interface TranscriptSegment {
  text: string;
  speaker: number | null;  // Speaker ID from diarization (0, 1, 2, etc.)
  channel: number;         // 0 for mono, 0/1 for stereo
  timestamp: number;
  isYou: boolean;          // Determined by diarization or channel
  isFinal?: boolean;       // true if finalized
  speechFinal?: boolean;   // true if end of utterance detected
  formattedTime?: string;  // Formatted timestamp like "0:15", "1:30"
}

export interface LanguageSettings {
  transcriptionLang: string;
  aiNotesLang: string;
  autoDetect: boolean;
}

export type TranscriptionEngine = 'deepgram' | 'parakeet';

export interface TranscriptionEngineInterface {
  setNativeModule(nativeModule: any): void;
  setOnTranscript(callback: (segment: TranscriptSegment) => void): void;
  startStreaming(): Promise<boolean> | boolean;
  stopStreaming(): void;
  isCurrentlyStreaming(): boolean;
}

