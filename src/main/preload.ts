import { contextBridge, ipcRenderer } from 'electron';

export interface GhostAPI {
  // Permissions
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
  refreshPermissions(): Promise<{
    screenRecording: boolean;
    microphone: boolean;
    accessibility: boolean;
  }>;

  // Window control
  minimizeToTray(): Promise<void>;

  // Meeting detection
  getMeetingStatus(): Promise<{
    provider: string;
    title: string;
    pid: number;
    windowId: number;
    isBrowser: boolean;
    browserName?: string;
    url?: string;
    detectedAt: number;
  } | null>;

  // Recording
  startRecording(): Promise<{ success: boolean; error?: string }>;
  stopRecording(): Promise<{ success: boolean; audioPath?: string; error?: string }>;
  getRecordingStatus(): Promise<{ isRecording: boolean; duration: number }>;

  // Events
  onMeetingDetected(callback: (meeting: any) => void): () => void;
  onMeetingEnded(callback: () => void): () => void;
  onRecordingStarted(callback: (meeting: any) => void): () => void;
  onRecordingStopped(callback: (data: { audioPath?: string }) => void): () => void;
  onNativeError(callback: (error: string) => void): () => void;
}

const ghostAPI: GhostAPI = {
  // Permissions
  getPermissions: () => ipcRenderer.invoke('get-permissions'),
  requestPermissions: () => ipcRenderer.invoke('request-permissions'),
  refreshPermissions: () => ipcRenderer.invoke('refresh-permissions'),

  // Window control
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),

  // Meeting detection
  getMeetingStatus: () => ipcRenderer.invoke('get-meeting-status'),

  // Recording
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  getRecordingStatus: () => ipcRenderer.invoke('get-recording-status'),

  // Events
  onMeetingDetected: (callback) => {
    const handler = (_: any, meeting: any) => callback(meeting);
    ipcRenderer.on('meeting-detected', handler);
    return () => ipcRenderer.removeListener('meeting-detected', handler);
  },
  onMeetingEnded: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('meeting-ended', handler);
    return () => ipcRenderer.removeListener('meeting-ended', handler);
  },
  onRecordingStarted: (callback) => {
    const handler = (_: any, meeting: any) => callback(meeting);
    ipcRenderer.on('recording-started', handler);
    return () => ipcRenderer.removeListener('recording-started', handler);
  },
  onRecordingStopped: (callback) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('recording-stopped', handler);
    return () => ipcRenderer.removeListener('recording-stopped', handler);
  },
  onNativeError: (callback) => {
    const handler = (_: any, error: string) => callback(error);
    ipcRenderer.on('native-error', handler);
    return () => ipcRenderer.removeListener('native-error', handler);
  },
};

contextBridge.exposeInMainWorld('ghost', ghostAPI);

