import React, { useEffect, useState, useCallback } from 'react';
import './App.css';

interface Meeting {
  provider: 'zoom' | 'teams' | 'meet' | 'slack' | 'webex';
  title: string;
  pid: number;
  windowId: number;
  isBrowser: boolean;
  browserName?: string;
  url?: string;
  detectedAt: number;
}

interface Permissions {
  screenRecording: boolean;
  microphone: boolean;
  accessibility: boolean;
}

type AppState = 'loading' | 'permissions' | 'idle' | 'meeting-detected' | 'recording';

const PROVIDER_INFO: Record<string, { name: string; icon: string; color: string }> = {
  zoom: { name: 'Zoom', icon: '📹', color: '#2D8CFF' },
  teams: { name: 'Microsoft Teams', icon: '👥', color: '#6264A7' },
  meet: { name: 'Google Meet', icon: '🎥', color: '#00897B' },
  slack: { name: 'Slack', icon: '💬', color: '#4A154B' },
  webex: { name: 'Webex', icon: '🌐', color: '#00BCF2' },
};

// Mock ghost API for development without Electron
const mockGhost = {
  getPermissions: async () => ({ screenRecording: true, microphone: true, accessibility: true }),
  requestPermissions: async () => ({ screenRecording: true, microphone: true, accessibility: true }),
  refreshPermissions: async () => ({ screenRecording: true, microphone: true, accessibility: true }),
  minimizeToTray: async () => {},
  getMeetingStatus: async () => null,
  startRecording: async () => ({ success: true }),
  stopRecording: async () => ({ success: true, audioPath: '/tmp/test.wav' }),
  getRecordingStatus: async () => ({ isRecording: false, duration: 0 }),
  onMeetingDetected: () => () => {},
  onMeetingEnded: () => () => {},
  onRecordingStarted: () => () => {},
  onRecordingStopped: () => () => {},
  onNativeError: () => () => {},
};

// Use real ghost API if available (Electron), otherwise use mock
const ghost = typeof window !== 'undefined' && (window as any).ghost ? (window as any).ghost : mockGhost;
const isElectron = typeof window !== 'undefined' && !!(window as any).ghost;

function App() {
  const [state, setState] = useState<AppState>('loading');
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastRecording, setLastRecording] = useState<string | null>(null);

  // Check permissions on load
  useEffect(() => {
    const checkPermissions = async () => {
      try {
        const perms = await ghost.getPermissions();
        setPermissions(perms);
        
        const allGranted = perms.screenRecording && perms.microphone && perms.accessibility;
        if (allGranted) {
          // Check if there's an active meeting
          const meetingStatus = await ghost.getMeetingStatus();
          if (meetingStatus) {
            setMeeting(meetingStatus);
            setState('meeting-detected');
          } else {
            setState('idle');
          }
        } else {
          setState('permissions');
        }
      } catch (e) {
        setError('Failed to check permissions');
        setState('permissions');
      }
    };

    checkPermissions();
  }, []);

  // Subscribe to events
  useEffect(() => {
    const unsubMeetingDetected = ghost.onMeetingDetected((m: Meeting) => {
      setMeeting(m);
      if (!isRecording) {
        setState('meeting-detected');
      }
    });

    const unsubMeetingEnded = ghost.onMeetingEnded(async () => {
      setMeeting(null);
      // If recording when meeting ends, auto-stop recording
      if (isRecording) {
        try {
          await ghost.stopRecording();
        } catch (e) {
          console.error('Failed to stop recording:', e);
        }
      }
      setState('idle');
    });

    const unsubRecordingStarted = ghost.onRecordingStarted(() => {
      setIsRecording(true);
      setState('recording');
    });

    const unsubRecordingStopped = ghost.onRecordingStopped(({ audioPath }: { audioPath?: string }) => {
      setIsRecording(false);
      setRecordingDuration(0);
      if (audioPath) {
        setLastRecording(audioPath);
        console.log('Recording saved:', audioPath);
      }
      // Use callback form to get current meeting state (avoids stale closure)
      setMeeting(currentMeeting => {
        setState(currentMeeting ? 'meeting-detected' : 'idle');
        return currentMeeting;
      });
    });

    const unsubNativeError = ghost.onNativeError((err: string) => {
      setError(err);
    });

    return () => {
      unsubMeetingDetected();
      unsubMeetingEnded();
      unsubRecordingStarted();
      unsubRecordingStopped();
      unsubNativeError();
    };
  }, [meeting, isRecording]);

  // Recording duration timer
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(async () => {
      const status = await ghost.getRecordingStatus();
      setRecordingDuration(status.duration);
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording]);

  const handleRequestPermissions = useCallback(async () => {
    try {
      const perms = await ghost.requestPermissions();
      setPermissions(perms);
      
      const allGranted = perms.screenRecording && perms.microphone && perms.accessibility;
      if (allGranted) {
        setState('idle');
      }
    } catch (e) {
      setError('Failed to request permissions');
    }
  }, []);

  const handleRefreshPermissions = useCallback(async () => {
    try {
      const perms = await ghost.refreshPermissions();
      setPermissions(perms);
      
      const allGranted = perms.screenRecording && perms.microphone && perms.accessibility;
      if (allGranted) {
        setState('idle');
      }
    } catch (e) {
      setError('Failed to refresh permissions');
    }
  }, []);

  const handleStartRecording = useCallback(async () => {
    try {
      setError(null);
      const result = await ghost.startRecording();
      if (!result.success) {
        setError(result.error || 'Failed to start recording');
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const handleStopRecording = useCallback(async () => {
    try {
      const result = await ghost.stopRecording();
      if (!result.success) {
        setError(result.error || 'Failed to stop recording');
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="app">
      {/* Draggable title bar */}
      <div className="title-bar drag-region">
        <div className="title-bar-content">
          <div className="logo">
            <span className="logo-icon">👻</span>
            <span className="logo-text">Ghost</span>
          </div>
          {!isElectron && (
            <div className="dev-badge">DEV MODE</div>
          )}
          <div className="window-controls no-drag">
            <button className="window-btn close" />
            <button className="window-btn minimize" />
            <button className="window-btn maximize" />
          </div>
        </div>
      </div>

      <div className="content">
        {/* Error banner */}
        {error && (
          <div className="error-banner animate-slide-up">
            <span className="error-icon">⚠️</span>
            <span className="error-text">{error}</span>
            <button className="error-dismiss" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* Loading state */}
        {state === 'loading' && (
          <div className="state-card">
            <div className="spinner" />
            <p className="state-text">Initializing...</p>
          </div>
        )}

        {/* Permissions state */}
        {state === 'permissions' && permissions && (
          <div className="state-card animate-fade-in">
            <div className="permissions-header">
              <span className="permissions-icon">🔐</span>
              <h2>Permissions Required</h2>
              <p className="permissions-desc">
                Ghost needs access to capture meeting audio and detect active speakers.
              </p>
            </div>

            <div className="permissions-list">
              <div className={`permission-item ${permissions.screenRecording ? 'granted' : ''}`}>
                <span className="permission-icon">{permissions.screenRecording ? '✓' : '○'}</span>
                <div className="permission-info">
                  <span className="permission-name">Screen Recording</span>
                  <span className="permission-desc">Required to capture meeting audio</span>
                </div>
              </div>

              <div className={`permission-item ${permissions.microphone ? 'granted' : ''}`}>
                <span className="permission-icon">{permissions.microphone ? '✓' : '○'}</span>
                <div className="permission-info">
                  <span className="permission-name">Microphone</span>
                  <span className="permission-desc">Required to capture your voice</span>
                </div>
              </div>

              <div className={`permission-item ${permissions.accessibility ? 'granted' : ''}`}>
                <span className="permission-icon">{permissions.accessibility ? '✓' : '○'}</span>
                <div className="permission-info">
                  <span className="permission-name">Accessibility</span>
                  <span className="permission-desc">Required to detect meeting windows</span>
                </div>
              </div>
            </div>

            {permissions.screenRecording && permissions.microphone && permissions.accessibility ? (
              <button className="btn-primary btn-tray" onClick={() => ghost.minimizeToTray()}>
                ✓ All Set - Minimize to Menu Bar
              </button>
            ) : (
              <>
                <button className="btn-primary" onClick={handleRequestPermissions}>
                  Grant Permissions
                </button>
                <button className="btn-secondary" onClick={handleRefreshPermissions}>
                  Refresh Status
                </button>
              </>
            )}

            <p className="permissions-note">
              You may need to enable permissions in System Settings → Privacy & Security
            </p>
          </div>
        )}

        {/* Idle state - waiting for meeting */}
        {state === 'idle' && (
          <div className="state-card animate-fade-in">
            <div className="idle-visual">
              <div className="radar">
                <div className="radar-ring" />
                <div className="radar-ring" style={{ animationDelay: '0.5s' }} />
                <div className="radar-ring" style={{ animationDelay: '1s' }} />
                <div className="radar-center">👁️</div>
              </div>
            </div>
            <h2 className="state-title">Watching for Meetings</h2>
            <p className="state-text">
              Ghost will detect when you join a meeting and show a notification.
            </p>

            <div className="supported-apps">
              {Object.entries(PROVIDER_INFO).map(([key, info]) => (
                <div key={key} className="app-badge" style={{ '--app-color': info.color } as any}>
                  <span>{info.icon}</span>
                  <span>{info.name}</span>
                </div>
              ))}
            </div>

            <button className="btn-secondary btn-minimize" onClick={() => ghost.minimizeToTray()}>
              Hide to Menu Bar
            </button>

            {lastRecording && (
              <div className="last-recording">
                <span className="last-recording-label">Last recording:</span>
                <span className="last-recording-path">{lastRecording.split('/').pop()}</span>
              </div>
            )}
          </div>
        )}

        {/* Meeting detected state */}
        {state === 'meeting-detected' && meeting && (
          <div className="state-card animate-fade-in">
            <div className="meeting-detected">
              <div 
                className="meeting-provider-badge"
                style={{ '--provider-color': PROVIDER_INFO[meeting.provider]?.color || '#666' } as any}
              >
                <span className="provider-icon">{PROVIDER_INFO[meeting.provider]?.icon || '📞'}</span>
                <span className="provider-name">{PROVIDER_INFO[meeting.provider]?.name || meeting.provider}</span>
              </div>

              <h2 className="meeting-title">{meeting.title}</h2>
              
              {meeting.isBrowser && (
                <p className="meeting-browser">
                  via {meeting.browserName}
                </p>
              )}

              <button className="btn-record" onClick={handleStartRecording}>
                <span className="record-icon">●</span>
                <span>Start Recording</span>
              </button>

              <p className="recording-note">
                Audio will be captured from the meeting window
              </p>

              {lastRecording && (
                <div className="last-recording">
                  <span className="last-recording-label">✅ Last recording:</span>
                  <span className="last-recording-path">{lastRecording.split('/').pop()}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recording state */}
        {state === 'recording' && (
          <div className="state-card recording-state animate-fade-in">
            <div className="recording-visual">
              <div className="recording-pulse" />
              <div className="recording-dot" />
            </div>

            <div className="recording-info">
              <span className="recording-label">Recording</span>
              <span className="recording-timer">{formatDuration(recordingDuration)}</span>
            </div>

            {meeting && (
              <div className="recording-meeting">
                <span className="provider-icon">{PROVIDER_INFO[meeting.provider]?.icon || '📞'}</span>
                <span className="meeting-title-small">{meeting.title}</span>
              </div>
            )}

            <div className="audio-meter">
              <div className="meter-bar" style={{ '--level': '0.6' } as any} />
              <div className="meter-bar" style={{ '--level': '0.8' } as any} />
              <div className="meter-bar" style={{ '--level': '0.4' } as any} />
              <div className="meter-bar" style={{ '--level': '0.9' } as any} />
              <div className="meter-bar" style={{ '--level': '0.5' } as any} />
            </div>

            <button className="btn-stop" onClick={handleStopRecording}>
              <span className="stop-icon">■</span>
              <span>Stop Recording</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="footer">
        <span className="version">v0.1.0</span>
        <span className="status-dot" data-status={isRecording ? 'recording' : 'idle'} />
      </div>
    </div>
  );
}

export default App;
