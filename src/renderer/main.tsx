import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

declare global {
  interface Window {
    ghost: {
      getPermissions(): Promise<{
        screenRecording: boolean;
        microphone: boolean;
        accessibility: boolean;
      }>;
      requestPermissions(): Promise<{
        screenRecording: boolean;
        microphone: boolean;
        accessibility: boolean;
      }>;
      getMeetingStatus(): Promise<any>;
      startRecording(): Promise<{ success: boolean; error?: string }>;
      stopRecording(): Promise<{ success: boolean; audioPath?: string; error?: string }>;
      getRecordingStatus(): Promise<{ isRecording: boolean; duration: number }>;
      onMeetingDetected(callback: (meeting: any) => void): () => void;
      onMeetingEnded(callback: () => void): () => void;
      onRecordingStarted(callback: (meeting: any) => void): () => void;
      onRecordingStopped(callback: (data: { audioPath?: string }) => void): () => void;
      onNativeError(callback: (error: string) => void): () => void;
    };
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);







