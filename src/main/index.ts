// Load environment variables from .env file
import dotenv from 'dotenv';
import path from 'path';

// In production, .env is in the Resources folder
if (process.env.NODE_ENV === 'development') {
  dotenv.config();
} else {
  // Production: load from app resources
  const envPath = path.join(process.resourcesPath || '', '.env');
  console.log('[App] Loading .env from:', envPath);
  dotenv.config({ path: envPath });
}

// Handle EPIPE errors gracefully (happens when stdout/stderr is closed during shutdown)
process.stdout?.on?.('error', (err: any) => {
  if (err.code === 'EPIPE') return; // Ignore EPIPE errors
  throw err;
});
process.stderr?.on?.('error', (err: any) => {
  if (err.code === 'EPIPE') return; // Ignore EPIPE errors
  throw err;
});

// Polyfill for undici/openai compatibility with Electron
// These globals are expected by undici but not available in Electron's main process
if (typeof (globalThis as any).File === 'undefined') {
  (globalThis as any).File = class {
    name: string;
    lastModified: number;
    size: number = 0;
    type: string = '';
    constructor(chunks: any[], name: string, options?: any) {
      this.name = name;
      this.lastModified = options?.lastModified || Date.now();
    }
  };
}
if (typeof (globalThis as any).FormData === 'undefined') {
  (globalThis as any).FormData = class {
    private data: Map<string, any> = new Map();
    append(name: string, value: any) { this.data.set(name, value); }
    get(name: string) { return this.data.get(name); }
    has(name: string) { return this.data.has(name); }
    delete(name: string) { this.data.delete(name); }
    entries() { return this.data.entries(); }
  };
}

import { app, BrowserWindow, ipcMain, systemPreferences, shell, Tray, Menu, Notification, nativeImage, screen, powerMonitor, dialog } from 'electron';
import fs from 'fs';
import { MeetingWatcher, MeetingInfo } from './meeting-watcher';
import { AudioEngine } from './audio-engine';
import { TranscriptionService } from './transcription';
import { getTranscriptionRouter } from './transcription/router';
import { CalendarService } from './calendar';
import { OpenAIService } from './openai';
import { setNativeModuleForAI, getAIEngine, setAIEngine, isLocalLLMReady, generateEnhancedNotesWithRouter, askQuestionWithRouter, suggestTemplateWithRouter, suggestFolderWithRouter } from './ai-router';
// Note: Folder service replaced with database service
import { getVectorSearchService } from './vector-search';
import { databaseService } from './database';
import type { CalendarEvent } from './calendar';
import { exec } from 'child_process';

// Migration flag for SQLite database
const MIGRATION_DONE_FLAG = path.join(app.getPath('userData'), '.db-migrated');

// Flag to track if we're truly quitting vs hiding to tray
let forceQuit = false;

// ============================================================================
// SETTINGS STORE
// ============================================================================
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

const store = {
  data: {} as Record<string, any>,
  load() {
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        this.data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      }
    } catch (e) {
      console.error('[Settings] Error loading:', e);
    }
  },
  save() {
    try {
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error('[Settings] Error saving:', e);
    }
  },
  get(key: string, defaultValue: any = null) {
    return this.data[key] ?? defaultValue;
  },
  set(key: string, value: any) {
    this.data[key] = value;
    this.save();
  }
};
store.load();

// ============================================================================
// STATE
// ============================================================================
let tray: Tray | null = null;
let anchorWindow: BrowserWindow | null = null; // Hidden window to keep app alive
let meetingBarWindow: BrowserWindow | null = null; // Floating meeting bar
let reminderWindow: BrowserWindow | null = null; // Meeting reminder slide-in
let editorWindow: BrowserWindow | null = null;
// Transcript widget removed - transcription now handled directly in editor
let settingsWindow: BrowserWindow | null = null;
let meetingIndicatorWindow: BrowserWindow | null = null; // Always-on-top recording indicator
let meetingWatcher: MeetingWatcher | null = null;
let audioEngine: AudioEngine | null = null;
let transcriptionService: TranscriptionService | null = null;
let transcriptionRouter = getTranscriptionRouter();
let calendarService: CalendarService | null = null;
let openaiService: OpenAIService | null = null;
let currentMeeting: MeetingInfo | null = null;
let isRecording = false;
let currentTranscript: string[] = []; // String format for AI notes
let currentTranscriptSegments: any[] = []; // Full segment objects for editor sync
let lastNotifiedMeetingPid: number | null = null; // Track which meeting we already showed bar for
let currentRecordingNoteId: string | null = null; // Track the note being recorded
let recordingStartTime: number = 0; // Track when recording started
let recordingElapsedSeconds: number = 0; // Track elapsed recording time
let isRecordingPaused: boolean = false; // Track pause state
let pauseStartTime: number = 0; // When pause started
let elapsedTimeInterval: ReturnType<typeof setInterval> | null = null; // Timer for updating elapsed time
let autoSaveInterval: ReturnType<typeof setInterval> | null = null; // Auto-save when editor is closed
let pendingNoteToLoad: { noteId: string; isRecording: boolean; isPaused: boolean; recordingNoteId: string | null } | null = null; // Track note to load after window opens

const isDev = process.env.NODE_ENV === 'development';

// Auto-save transcript periodically when recording and editor is closed
function startAutoSaveInterval() {
  if (autoSaveInterval) return;
  
  autoSaveInterval = setInterval(() => {
    // Only auto-save if recording, editor is closed, and we have transcript
    if (isRecording && !editorWindow && currentTranscriptSegments.length > 0 && currentRecordingNoteId) {
      console.log('[AutoSave] Saving transcript while editor is closed...');
      console.log('[AutoSave] Note ID:', currentRecordingNoteId, 'Segments:', currentTranscriptSegments.length);
      
      try {
        // CRITICAL: Only save FINAL segments, not interim ones
        const finalSegments = currentTranscriptSegments.filter(seg => seg.isFinal !== false);
        console.log('[AutoSave] Total segments:', currentTranscriptSegments.length, 'Final segments:', finalSegments.length);
        
        // Trigger the save-note handler logic
        const savedId = databaseService.saveNote({
          id: currentRecordingNoteId,
          title: currentMeeting?.title || 'Voice Note',
          provider: currentMeeting?.provider || 'manual',
          date: new Date().toISOString(),
          transcript: JSON.stringify(finalSegments),
          notes: '',
          enhancedNotes: null,
          audioPath: null,
          calendarEventId: null,
          startTime: null,
          folderId: null,
          templateId: null
        });
        
        console.log('[AutoSave] ✅ Transcript saved to database, note ID:', savedId);
        
        // Verify it was saved
        const saved = databaseService.getNote(currentRecordingNoteId);
        if (saved) {
          console.log('[AutoSave] ✅ Verified: note exists with transcript length:', saved.transcript?.length || 0);
        } else {
          console.error('[AutoSave] ❌ ERROR: Note not found after save!');
        }
      } catch (err) {
        console.error('[AutoSave] ❌ Failed to save:', err);
      }
    }
  }, 10000); // Save every 10 seconds
}

function stopAutoSaveInterval() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}

// Notes storage - now using SQLite database (icecubes.db)
// Legacy JSON files in 'notes/' folder are no longer used

// ============================================================================
// NOTES STORAGE
// ============================================================================
interface Note {
  id: string;
  title: string;
  provider: string;
  date: string;
  transcript: string[] | any[];
  notes?: string;  // User's raw notes
  enhancedNotes?: string;  // AI-generated notes (stored separately)
  audioPath?: string;
  calendarEventId?: string;  // Link to calendar event
  startTime?: string;  // Scheduled meeting time
  folderId?: string;  // Folder this note belongs to
  suggestedFolderId?: string;  // AI-suggested folder
  suggestedFolderConfidence?: 'high' | 'medium' | 'low';  // Confidence level
  templateId?: string;  // Template used to generate AI notes
  people?: string[];  // People mentioned in the note
  companies?: string[];  // Companies mentioned in the note
}

// ============================================================================
// DATABASE-BACKED NOTE FUNCTIONS (SQLite only)
// ============================================================================

function saveNote(note: Note): string {
  databaseService.saveNote({
    id: note.id,
    title: note.title,
    provider: note.provider,
    date: note.date,
    transcript: JSON.stringify(note.transcript || []),
    notes: note.notes || '',
    enhancedNotes: note.enhancedNotes || null,
    audioPath: note.audioPath || null,
    calendarEventId: note.calendarEventId || null,
    startTime: note.startTime || null,
    folderId: note.folderId || null,
    templateId: note.templateId || null
  });
  
  // Add people and companies to junction tables
  if (note.people) {
    note.people.forEach(person => databaseService.addPersonToNote(note.id, person));
  }
  if (note.companies) {
    note.companies.forEach(company => databaseService.addCompanyToNote(note.id, company));
  }
  
  return note.id;
}

function loadNotes(): Note[] {
  const dbNotes = databaseService.getAllNotes();
  return dbNotes.map(n => ({
    ...n,
    transcript: JSON.parse(n.transcript || '[]'),
    enhancedNotes: n.enhancedNotes ?? undefined,
    audioPath: n.audioPath ?? undefined,
    calendarEventId: n.calendarEventId ?? undefined,
    startTime: n.startTime ?? undefined,
    folderId: n.folderId ?? undefined,
    templateId: n.templateId ?? undefined,
    people: databaseService.getPeopleForNote(n.id).map(p => p.name),
    companies: databaseService.getCompaniesForNote(n.id).map(c => c.name)
  }));
}

function loadNote(id: string): Note | null {
  const note = databaseService.getNote(id);
  if (!note) return null;
  const result = {
    ...note,
    transcript: JSON.parse(note.transcript || '[]'),
    enhancedNotes: note.enhancedNotes ?? undefined,
    audioPath: note.audioPath ?? undefined,
    calendarEventId: note.calendarEventId ?? undefined,
    startTime: note.startTime ?? undefined,
    folderId: note.folderId ?? undefined,
    templateId: note.templateId ?? undefined,
    people: databaseService.getPeopleForNote(id).map(p => p.name),
    companies: databaseService.getCompaniesForNote(id).map(c => c.name)
  };
  console.log('[LoadNote] ID:', id, 'Title:', note.title, 'FolderId:', result.folderId);
  return result;
}

function deleteNote(id: string): boolean {
  return databaseService.deleteNote(id);
}

// ============================================================================
// ANCHOR WINDOW - Hidden window to keep the app process stable
// ============================================================================
function createAnchorWindow() {
  anchorWindow = new BrowserWindow({
    width: 1,
    height: 1,
    x: -100,
    y: -100,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
    },
  });
  
  anchorWindow.loadURL('about:blank');
  console.log('[Anchor] Hidden window created');
}

// ============================================================================
// TRAY - ALWAYS VISIBLE, COMPLETELY INDEPENDENT
// The tray is created ONCE and NEVER destroyed or recreated
// ============================================================================
function createTray() {
  if (tray) {
    console.log('[Tray] Already exists, skipping');
    return;
  }
  
  console.log('[Tray] Creating system tray...');
  
  try {
    // Load logo and resize for tray (32x32 for retina, will be displayed at 16x16)
    let icon: Electron.NativeImage;
    const logoPath = path.join(__dirname, '..', 'renderer', 'assets', 'logo.png');
    
    if (fs.existsSync(logoPath)) {
      icon = nativeImage.createFromPath(logoPath);
      // Resize to 32x32 for retina display (shows as 16x16 in menu bar)
      icon = icon.resize({ width: 32, height: 32 });
      console.log('[Tray] Using logo icon');
    } else {
      // Fallback to minimal icon
      icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      );
      console.log('[Tray] Logo not found, using fallback');
    }
    
    tray = new Tray(icon);
    tray.setToolTip('IceCubes - AI Meeting Notes');
    
    // Set initial menu with quit options
    const initialMenu = Menu.buildFromTemplate([
      { label: 'IceCubes', enabled: false },
      { type: 'separator' },
      { label: 'Open', click: () => openEditorWindow() },
      { label: 'Settings', click: openSettingsWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => {
        // Hide from dock but keep running
        if (process.platform === 'darwin' && app.dock) {
          app.dock.hide();
        }
        if (editorWindow && !editorWindow.isDestroyed()) {
          editorWindow.hide();
        }
      }},
      { 
        label: 'Quit Options',
        submenu: [
          { 
            label: 'Restart IceCubes', 
            click: () => {
              forceQuit = true;
              app.relaunch();
              app.quit();
            }
          },
          { 
            label: 'Quit Completely', 
            click: () => {
              forceQuit = true;
              app.quit();
            }
          },
        ]
      },
    ]);
    tray.setContextMenu(initialMenu);
    
    // Store globally to prevent garbage collection - CRITICAL
    (global as any).__ghostTray = tray;
    (global as any).__ghostTrayRef = tray; // Double reference
    
    console.log('[Tray] ✅ Created successfully');
  } catch (e) {
    console.error('[Tray] Failed to create:', e);
  }
}

// Safe menu update - deferred to avoid race conditions
function updateTrayMenu() {
  // Use setTimeout to defer update and avoid blocking
  setTimeout(() => {
    if (!tray || tray.isDestroyed()) {
      console.log('[Tray] Cannot update - tray not available');
      return;
    }
    
    try {
      const menuItems: Electron.MenuItemConstructorOptions[] = [];
      
  // Status
  if (isRecording && currentMeeting) {
    menuItems.push({
      label: `🔴 Recording: ${currentMeeting.provider}`,
      enabled: false,
    });
    menuItems.push({
      label: 'Open Current Note',
      click: () => setTimeout(() => {
        console.log('[Tray] Open Current Note clicked, noteId:', currentRecordingNoteId);
        
        // CRITICAL: Force save the current transcript to DB BEFORE opening
        if (isRecording && currentRecordingNoteId && currentTranscriptSegments.length > 0) {
          // CRITICAL: Only save FINAL segments, not interim ones
          const finalSegments = currentTranscriptSegments.filter(seg => seg.isFinal !== false);
          console.log('[Tray] Force saving note before open:', currentRecordingNoteId, 'total:', currentTranscriptSegments.length, 'final:', finalSegments.length);
          try {
            databaseService.saveNote({
              id: currentRecordingNoteId,
              title: currentMeeting?.title || 'Voice Note',
              provider: currentMeeting?.provider || 'manual',
              date: new Date().toISOString(),
              transcript: JSON.stringify(finalSegments),
              notes: '',
              enhancedNotes: null,
              audioPath: null,
              calendarEventId: null,
              startTime: null,
              folderId: null,
              templateId: null
            });
            console.log('[Tray] ✅ Force saved note before opening');
          } catch (err) {
            console.error('[Tray] Failed to force save:', err);
          }
        }
        
        // Show dock icon
        if (process.platform === 'darwin' && app.dock) {
          app.dock.show();
        }
        
        if (editorWindow && !editorWindow.isDestroyed()) {
          // Window exists - show it and load the current note
          editorWindow.show();
          editorWindow.focus();
          
          // Send the current recording note to the editor
          if (currentRecordingNoteId) {
            editorWindow.webContents.send('open-note-from-indicator', {
              noteId: currentRecordingNoteId,
              isRecording: isRecording,
              isPaused: isRecordingPaused,
              recordingNoteId: currentRecordingNoteId
            });
            console.log('[Tray] Sent open-note-from-indicator with noteId:', currentRecordingNoteId);
          } else {
            editorWindow.webContents.send('show-editor-view');
          }
        } else {
          // No window - create one and load the note
          console.log('[Tray] Creating new editor window for noteId:', currentRecordingNoteId);
          
          // Set pending note to load - it will be sent after window finishes loading
          if (currentRecordingNoteId) {
            console.log('[Tray] Setting pending note to load:', currentRecordingNoteId);
            pendingNoteToLoad = {
              noteId: currentRecordingNoteId,
              isRecording: isRecording,
              isPaused: isRecordingPaused,
              recordingNoteId: currentRecordingNoteId
            };
          }
          
          openEditorWindow(false);
        }
      }, 0),
    });
    menuItems.push({
      label: '⏹ Stop Recording',
      click: () => setTimeout(stopRecording, 0),
    });
  } else if (currentMeeting) {
        menuItems.push({
          label: `📍 ${currentMeeting.provider.toUpperCase()}: ${currentMeeting.title.slice(0, 25)}...`,
          enabled: false,
        });
        menuItems.push({
          label: '🔴 Start Recording',
          click: () => setTimeout(startRecording, 0),
        });
      } else {
        menuItems.push({
          label: '⏳ Watching for meetings...',
          enabled: false,
        });
      }
      
      menuItems.push({ type: 'separator' });
      
      menuItems.push({
        label: 'Open',
        click: () => setTimeout(openEditorWindow, 0),
      });
      
      menuItems.push({ type: 'separator' });
      
      menuItems.push({
        label: 'Settings',
        click: () => setTimeout(openSettingsWindow, 0),
      });
      
      menuItems.push({ type: 'separator' });
      
      menuItems.push({
        label: 'Quit',
        click: () => {
          // Hide from dock but keep running in tray
          if (process.platform === 'darwin' && app.dock) {
            app.dock.hide();
          }
          if (editorWindow && !editorWindow.isDestroyed()) {
            editorWindow.hide();
          }
        },
      });
      
      menuItems.push({
        label: 'Quit Options',
        submenu: [
          { 
            label: 'Restart IceCubes', 
            click: () => {
              forceQuit = true;
              app.relaunch();
              app.quit();
            }
          },
          { 
            label: 'Quit Completely', 
            click: () => {
              forceQuit = true;
              app.quit();
            }
          },
        ]
      });
      
      tray.setContextMenu(Menu.buildFromTemplate(menuItems));
      console.log('[Tray] Menu updated');
    } catch (e) {
      console.error('[Tray] Error updating menu:', e);
    }
  }, 10);
}

// ============================================================================
// MEETING BAR - Floating bar that slides in when meeting detected
// ============================================================================
function showMeetingBar(meeting: MeetingInfo) {
  // Close existing bar if any
  if (meetingBarWindow && !meetingBarWindow.isDestroyed()) {
    meetingBarWindow.close();
    meetingBarWindow = null;
  }
  
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const barWidth = 320;
  const barHeight = 60;
  const margin = 16;
  
  meetingBarWindow = new BrowserWindow({
    width: barWidth,
    height: barHeight,
    x: width - barWidth - margin,
    y: margin + 30, // Below menu bar
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  
  meetingBarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  if (isDev) {
    meetingBarWindow.loadURL('http://localhost:5173/meeting-bar.html');
  } else {
    meetingBarWindow.loadFile(path.join(__dirname, '../renderer/meeting-bar.html'));
  }
  
  meetingBarWindow.once('ready-to-show', () => {
    meetingBarWindow?.webContents.send('set-meeting', meeting);
  });
  
  // Also send after a small delay to ensure window is ready
  setTimeout(() => {
    if (meetingBarWindow && !meetingBarWindow.isDestroyed()) {
      meetingBarWindow.webContents.send('set-meeting', {
        ...meeting,
        appName: meeting.isBrowser ? 'Chrome' : meeting.provider,
      });
    }
  }, 100);
  
  meetingBarWindow.on('closed', () => {
    meetingBarWindow = null;
  });
  
  console.log('[MeetingBar] Shown for', meeting.provider);
}

function closeMeetingBar() {
  if (meetingBarWindow && !meetingBarWindow.isDestroyed()) {
    meetingBarWindow.close();
    meetingBarWindow = null;
  }
}

// ============================================================================
// MEETING REMINDER - Slide-in notification 3 min before meeting
// ============================================================================
function showMeetingReminder(event: CalendarEvent) {
  // Check if scheduled meeting notifications are enabled
  const notifSettings = store.get('notifSettings', {
    scheduledMeetings: true,
    autoDetectedMeetings: true,
    mutedApps: []
  });
  
  if (!notifSettings.scheduledMeetings) {
    console.log('[Reminder] Scheduled meeting notifications disabled');
    return;
  }
  
  // Close existing reminder if any
  if (reminderWindow && !reminderWindow.isDestroyed()) {
    reminderWindow.close();
    reminderWindow = null;
  }
  
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const barWidth = 360;
  const barHeight = 320; // Taller to accommodate expanded view
  const margin = 16;
  
  reminderWindow = new BrowserWindow({
    width: barWidth,
    height: barHeight,
    x: width - barWidth - margin,
    y: margin + 30, // Below menu bar
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  
  reminderWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  // Create inline HTML for the reminder
  const minutesUntil = Math.round((event.start.getTime() - Date.now()) / 60000);
  const timeStr = event.start.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
  
  // Extract attendees (exclude self)
  const attendees = (event.attendees || []).filter(a => !a.self);
  const attendeeCount = attendees.length;
  const attendeeNames = attendees
    .slice(0, 5)
    .map(a => a.displayName || a.email.split('@')[0])
    .join(', ');
  const moreAttendees = attendeeCount > 5 ? ` +${attendeeCount - 5} more` : '';
  
  // Extract agenda/description (clean up HTML and limit length)
  let agenda = (event.description || '')
    .replace(/<[^>]*>/g, ' ')  // Remove HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (agenda.length > 200) {
    agenda = agenda.substring(0, 200) + '...';
  }
  
  const hasDetails = true; // Always show details section
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
          background: transparent;
          -webkit-app-region: drag;
          padding: 8px;
        }
        .reminder {
          background: #ffffff;
          border-radius: 14px;
          padding: 14px 16px;
          color: #1f2937;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
          animation: slideIn 0.25s ease-out;
        }
        @keyframes slideIn {
          from { transform: translateX(120%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }
        .logo { font-size: 20px; line-height: 1; }
        .header-content {
          flex: 1;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .badge {
          background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
          color: #92400e;
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .time {
          font-size: 13px;
          color: #6b7280;
          font-weight: 500;
        }
        .title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .title {
          flex: 1;
          font-size: 14px;
          font-weight: 600;
          color: #111827;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
          font-size: 12px;
          color: #6b7280;
        }
        .meta-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .expand-btn {
          background: none;
          border: none;
          color: #6b7280;
          font-size: 11px;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
          transition: all 0.15s;
          -webkit-app-region: no-drag;
        }
        .expand-btn:hover {
          background: #f3f4f6;
          color: #374151;
        }
        .details {
          display: none;
          margin-bottom: 12px;
          padding: 10px 12px;
          background: #f9fafb;
          border-radius: 8px;
          font-size: 12px;
        }
        .details.show { display: block; }
        .details-section {
          margin-bottom: 10px;
        }
        .details-section:last-child { margin-bottom: 0; }
        .details-label {
          font-weight: 600;
          color: #374151;
          margin-bottom: 4px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .details-text {
          color: #6b7280;
          line-height: 1.4;
        }
        .details-text.empty {
          color: #9ca3af;
          font-style: italic;
        }
        .participant-list {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .participant {
          background: #e5e7eb;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 11px;
          color: #374151;
        }
        .actions {
          display: flex;
          gap: 8px;
          -webkit-app-region: no-drag;
        }
        .btn {
          flex: 1;
          padding: 9px 14px;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .btn:hover { transform: scale(1.02); }
        .btn:active { transform: scale(0.98); }
        .btn-join {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
        }
        .btn-dismiss {
          background: #f3f4f6;
          color: #4b5563;
        }
        .btn-dismiss:hover { background: #e5e7eb; }
      </style>
    </head>
    <body>
      <div class="reminder">
        <div class="header">
          <img class="logo" src="assets/logo.png" style="width:20px;height:20px;">
          <div class="header-content">
            <span class="badge">⏰ In ${minutesUntil} min</span>
            <span class="time">${timeStr}</span>
          </div>
        </div>
        <div class="title-row">
          <div class="title">${event.title}</div>
        </div>
        <div class="meta">
          ${attendeeCount > 0 ? `<span class="meta-item">👥 ${attendeeCount} participant${attendeeCount !== 1 ? 's' : ''}</span>` : ''}
          ${hasDetails ? `<button class="expand-btn" id="expandBtn" onclick="toggleDetails()">▼ Details</button>` : ''}
        </div>
        <div class="details" id="details">
          ${attendeeCount > 0 ? `
            <div class="details-section">
              <div class="details-label">👥 Participants</div>
              <div class="participant-list">
                ${attendees.slice(0, 8).map(a => `<span class="participant">${a.displayName || a.email.split('@')[0]}</span>`).join('')}
                ${attendeeCount > 8 ? `<span class="participant">+${attendeeCount - 8} more</span>` : ''}
              </div>
            </div>
          ` : ''}
          <div class="details-section">
              <div class="details-label">📋 Agenda</div>
              <div class="details-text${!agenda ? ' empty' : ''}">${agenda || 'No agenda provided'}</div>
            </div>
        </div>
        <div class="actions">
          ${event.meetingLink ? `<button class="btn btn-join" onclick="join()">Join Meeting</button>` : ''}
          <button class="btn btn-dismiss" onclick="dismiss()">Dismiss</button>
        </div>
      </div>
      <script>
        const { ipcRenderer, shell } = require('electron');
        let expanded = false;
        
        function toggleDetails() {
          expanded = !expanded;
          document.getElementById('details').classList.toggle('show', expanded);
          document.getElementById('expandBtn').textContent = expanded ? '▲ Hide' : '▼ Details';
        }
        
        function join() {
          ${event.meetingLink ? `shell.openExternal('${event.meetingLink}');` : ''}
          ipcRenderer.send('dismiss-reminder');
        }
        function dismiss() {
          ipcRenderer.send('dismiss-reminder');
        }
        // Auto-dismiss after 45 seconds (longer for reading details)
        setTimeout(() => ipcRenderer.send('dismiss-reminder'), 45000);
      </script>
    </body>
    </html>
  `;
  
  reminderWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  
  reminderWindow.on('closed', () => {
    reminderWindow = null;
  });
  
  console.log('[Reminder] Shown for:', event.title);
}

function closeReminder() {
  if (reminderWindow && !reminderWindow.isDestroyed()) {
    reminderWindow.close();
    reminderWindow = null;
  }
}

// ============================================================================
// MEETING INDICATOR - Always-on-top recording indicator on screen edge
// ============================================================================
// Store indicator position for persistence across show/hide
let indicatorPosition: { x: number; y: number } | null = null;

// Start tracking elapsed recording time
function startElapsedTimeTracking() {
  if (elapsedTimeInterval) clearInterval(elapsedTimeInterval);
  recordingElapsedSeconds = 0;
  elapsedTimeInterval = setInterval(() => {
    if (!isRecordingPaused && isRecording) {
      recordingElapsedSeconds++;
    }
  }, 1000);
}

// Stop tracking elapsed recording time
function stopElapsedTimeTracking() {
  if (elapsedTimeInterval) {
    clearInterval(elapsedTimeInterval);
    elapsedTimeInterval = null;
  }
}

function showMeetingIndicator(noteId: string) {
  // Don't show if editor window is visible and focused
  if (editorWindow && !editorWindow.isDestroyed() && editorWindow.isVisible() && editorWindow.isFocused()) {
    console.log('[MeetingIndicator] Editor is focused, not showing indicator');
    return;
  }
  
  console.log('[MeetingIndicator] Showing indicator for note:', noteId);
  
  // Close existing indicator if any
  if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
    meetingIndicatorWindow.close();
    meetingIndicatorWindow = null;
  }
  
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const indicatorWidth = 85;
  const indicatorHeight = 160;
  const margin = 12;
  
  // Use saved position or default to right side, vertically centered
  const x = indicatorPosition?.x ?? (width - indicatorWidth - margin);
  const y = indicatorPosition?.y ?? Math.floor((height - indicatorHeight) / 2);
  
  meetingIndicatorWindow = new BrowserWindow({
    width: indicatorWidth,
    height: indicatorHeight,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false, // Don't steal focus
    movable: true, // Allow dragging
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  
  meetingIndicatorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  // Track position when moved (for persistence)
  meetingIndicatorWindow.on('moved', () => {
    if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
      const bounds = meetingIndicatorWindow.getBounds();
      indicatorPosition = { x: bounds.x, y: bounds.y };
    }
  });
  
  // Load the indicator HTML
  if (isDev) {
    meetingIndicatorWindow.loadURL('http://localhost:5173/indicator.html');
  } else {
    meetingIndicatorWindow.loadFile(path.join(__dirname, '../renderer/indicator.html'));
  }
  
  // Send note info to indicator once loaded
  meetingIndicatorWindow.webContents.once('did-finish-load', () => {
    if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
      meetingIndicatorWindow.webContents.send('set-note-info', {
        noteId,
        elapsedSeconds: recordingElapsedSeconds,
      });
      // Send pause state
      if (isRecordingPaused) {
        meetingIndicatorWindow.webContents.send('set-paused', true);
      }
    }
  });
  
  meetingIndicatorWindow.on('closed', () => {
    meetingIndicatorWindow = null;
  });
  
  console.log('[MeetingIndicator] ✅ Indicator shown');
}

// Show indicator WITHOUT activating the app (for when editor loses focus)
function showMeetingIndicatorInactive(noteId: string) {
  console.log('[MeetingIndicator] Showing indicator INACTIVE for note:', noteId);
  
  // Close existing indicator if any
  if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
    meetingIndicatorWindow.close();
    meetingIndicatorWindow = null;
  }
  
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const indicatorWidth = 85;
  const indicatorHeight = 160;
  const margin = 12;
  
  const x = indicatorPosition?.x ?? (width - indicatorWidth - margin);
  const y = indicatorPosition?.y ?? Math.floor((height - indicatorHeight) / 2);
  
  const newIndicator = new BrowserWindow({
    width: indicatorWidth,
    height: indicatorHeight,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    movable: true,
    show: false, // Don't show immediately
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  
  // Assign to global immediately
  meetingIndicatorWindow = newIndicator;
  
  newIndicator.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  
  newIndicator.on('moved', () => {
    if (newIndicator && !newIndicator.isDestroyed()) {
      const bounds = newIndicator.getBounds();
      indicatorPosition = { x: bounds.x, y: bounds.y };
    }
  });
  
  // Handle load errors
  newIndicator.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[MeetingIndicator] ❌ Failed to load:', errorCode, errorDescription);
    // Try loading from file as fallback
    if (isDev && newIndicator && !newIndicator.isDestroyed()) {
      console.log('[MeetingIndicator] Trying file fallback...');
      newIndicator.loadFile(path.join(__dirname, '../renderer/indicator.html'));
    }
  });
  
  if (isDev) {
    console.log('[MeetingIndicator] Loading from dev server...');
    newIndicator.loadURL('http://localhost:5173/indicator.html');
  } else {
    newIndicator.loadFile(path.join(__dirname, '../renderer/indicator.html'));
  }
  
  // Use the captured window reference (newIndicator), not the global
  newIndicator.webContents.once('did-finish-load', () => {
    console.log('[MeetingIndicator] ✅ Page loaded successfully');
    try {
      // Check BOTH: that this window still exists AND that it's still the current indicator
      if (newIndicator && !newIndicator.isDestroyed() && meetingIndicatorWindow === newIndicator) {
        newIndicator.webContents.send('set-note-info', {
          noteId,
          elapsedSeconds: recordingElapsedSeconds,
        });
        if (isRecordingPaused) {
          newIndicator.webContents.send('set-paused', true);
        }
        // CRITICAL: Use showInactive to not steal focus
        newIndicator.showInactive();
        console.log('[MeetingIndicator] ✅ Indicator shown at position:', newIndicator.getBounds());
      } else if (newIndicator && newIndicator.isDestroyed()) {
        console.log('[MeetingIndicator] ❌ Window was destroyed before showing');
      } else {
        console.log('[MeetingIndicator] ⚠️ A newer indicator was created, skipping show');
      }
    } catch (err) {
      console.error('[MeetingIndicator] ❌ Error showing indicator:', err);
    }
  });
  
  // Fallback: show after timeout if did-finish-load doesn't fire
  setTimeout(() => {
    if (newIndicator && !newIndicator.isDestroyed() && !newIndicator.isVisible() && meetingIndicatorWindow === newIndicator) {
      console.log('[MeetingIndicator] ⚠️ Fallback: showing indicator after timeout');
      try {
        newIndicator.showInactive();
      } catch (err) {
        console.error('[MeetingIndicator] ❌ Fallback show failed:', err);
      }
    }
  }, 2000);
  
  newIndicator.on('closed', () => {
    if (meetingIndicatorWindow === newIndicator) {
      meetingIndicatorWindow = null;
    }
  });
}

// Update indicator visibility based on editor window state
function updateIndicatorVisibility() {
  if (!isRecording) return;
  
  const editorVisible = editorWindow && !editorWindow.isDestroyed() && 
                        editorWindow.isVisible() && !editorWindow.isMinimized();
  const editorFocused = editorWindow && !editorWindow.isDestroyed() && editorWindow.isFocused();
  
  if (editorVisible && editorFocused) {
    // Editor is visible and focused - hide indicator
    if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
      meetingIndicatorWindow.hide();
    }
  } else {
    // Editor not visible or not focused - show indicator
    // CRITICAL: Use showInactive() to NOT steal focus from other apps
    if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
      meetingIndicatorWindow.showInactive();
    } else if (isRecording) {
      // Create indicator if it doesn't exist
      showMeetingIndicatorInactive(currentRecordingNoteId || '');
    }
  }
}

function hideMeetingIndicator() {
  if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
    meetingIndicatorWindow.close();
    meetingIndicatorWindow = null;
    console.log('[MeetingIndicator] Hidden');
  }
}

function updateMeetingIndicatorTitle(title: string) {
  if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
    meetingIndicatorWindow.webContents.send('set-note-info', {
      title: title.length > 25 ? title.substring(0, 25) + '...' : title,
    });
  }
}

// ============================================================================
// RECORDING
// ============================================================================
async function startRecording() {
  console.log('[Recording] startRecording called');
  console.log('[Recording] currentMeeting:', currentMeeting?.title, 'windowId:', currentMeeting?.windowId);
  
  if (!currentMeeting) {
    console.log('[Recording] No current meeting - ABORTING');
    return;
  }
  if (!audioEngine) {
    console.log('[Recording] No audio engine');
    return;
  }
  if (isRecording) {
    console.log('[Recording] Already recording');
    return;
  }
  
  console.log('[Recording] Starting capture...');
  currentTranscript = [];
  currentTranscriptSegments = [];
  
  // Close existing transcript window to ensure fresh state
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.close();
    editorWindow = null;
  }
  
  try {
    // Start audio capture
    await audioEngine.startRecording(currentMeeting.pid, currentMeeting.provider);
    console.log('[Recording] Audio capture started');
    
    meetingWatcher?.setRecordingLock(true);
    isRecording = true;
    recordingStartTime = Date.now();
    startAutoSaveInterval(); // Auto-save transcript periodically
    
    // Start elapsed time tracking
    startElapsedTimeTracking();
    
    // Update tray menu (deferred, won't block)
    updateTrayMenu();
    
    // Reset recording state
    recordingElapsedSeconds = 0;
    isRecordingPaused = false;
    
    // Show the meeting indicator for auto-detected meetings
    // (noteId will be updated later when the renderer creates the note)
    showMeetingIndicator('');
    
    // Open editor window (show editor view, not home)
    console.log('[Recording] Opening editor window...');
    openEditorWindow(false);
    
    // Start streaming to Deepgram from main process (multichannel audio)
    setTimeout(() => {
      if (transcriptionRouter) {
        // Pass native module to transcription router
        transcriptionRouter.setNativeModule(getNativeModule());
        
        // Set up callback to forward transcripts to renderer
        transcriptionRouter.setOnTranscript((segment) => {
          // Simple labels: You vs Them (based on audio channel)
          const label = segment.isYou ? '[You]' : '[Them]';
          
          // Send to renderer (with safety checks for disposed frames)
          const enrichedSegment = {
            ...segment,
            speakerName: segment.isYou ? 'You' : 'Them',
          };
          
          try {
            if (editorWindow && !editorWindow.isDestroyed() && editorWindow.webContents && !editorWindow.webContents.isDestroyed()) {
              editorWindow.webContents.send('transcript-segment', enrichedSegment);
            }
          } catch (err) {
            // Silently ignore - window was closed/disposed during send
          }
          
          // Store in currentTranscript for AI notes (string format)
          currentTranscript.push(`${label} ${segment.text}`);
          // Store full segment for editor sync when window reopens
          currentTranscriptSegments.push(enrichedSegment);
        });
        
        // Start streaming
        transcriptionRouter.startStreaming();
        console.log('[Recording] Transcription streaming started');
      }
      
      // Also tell editor that transcription has started (for UI)
      if (editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send('start-transcription');
      }
    }, 1000);
    
    console.log('[Recording] ✅ Started successfully');
  } catch (e) {
    console.error('[Recording] Failed to start:', e);
    isRecording = false;
    stopAutoSaveInterval();
  }
}

async function stopRecording(): Promise<string | null> {
  if (!audioEngine || !isRecording) return null;
  
  console.log('[Recording] Stopping...');
  
  try {
    // Stop transcription streaming first
    if (transcriptionRouter) {
      transcriptionRouter.stopStreaming();
      console.log('[Recording] Transcription streaming stopped');
    }
    
    const audioPath = await audioEngine.stopRecording();
    
    // Delete the audio file - we don't store recordings
    if (audioPath && fs.existsSync(audioPath)) {
      try {
        fs.unlinkSync(audioPath);
        console.log('[Recording] Deleted temp audio file');
      } catch (e) {
        // Ignore deletion errors
      }
    }
    
    meetingWatcher?.setRecordingLock(false);
    isRecording = false;
    isRecordingPaused = false;
    stopElapsedTimeTracking();
    stopAutoSaveInterval();
    recordingElapsedSeconds = 0;
    currentRecordingNoteId = null;
    updateTrayMenu();
    
    // Hide the meeting indicator
    hideMeetingIndicator();
    
    // Tell editor window recording stopped (no audio path)
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('recording-stopped', {});
    }
    
    console.log('[Recording] ✅ Stopped');
    return null;
  } catch (e) {
    console.error('[Recording] Failed to stop:', e);
    hideMeetingIndicator();
    return null;
  }
}

function saveCurrentNote(audioPath?: string) {
  if (currentTranscript.length === 0 && !audioPath) return null;
  
  const note: Note = {
    id: Date.now().toString(),
    title: currentMeeting?.title || 'Untitled Meeting',
    provider: currentMeeting?.provider || 'unknown',
    date: new Date().toISOString(),
    transcript: currentTranscript,
    audioPath,
  };
  
  const notePath = saveNote(note);
  console.log('[Notes] Saved note:', notePath);
  
  // Notify editor window to refresh notes list
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.webContents.send('notes-updated');
  }
  
  return note;
}

// ============================================================================
// WINDOWS
// ============================================================================
function openEditorWindow(showHome = true) {
  console.log('[Editor] Opening editor window...', showHome ? '(home view)' : '(editor view)');
  console.log('[Editor] isDev:', isDev);
  
  // Show in dock when opening window with custom icon
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
    // Set dock icon to our logo PNG
    const pngPath = path.join(__dirname, '..', 'renderer', 'assets', 'logo.png');
    if (fs.existsSync(pngPath)) {
      const dockIcon = nativeImage.createFromPath(pngPath);
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon);
      }
    }
  }
  
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  // Close existing editor window if any
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.show();
    editorWindow.focus();
    
    // Reposition window based on view mode
    if (showHome) {
      // Home view: center of screen
      const editorWidth = Math.floor(width * 0.55);
      const editorHeight = Math.floor(height * 0.8);
      editorWindow.setBounds({
        x: Math.floor((width - editorWidth) / 2),
        y: Math.floor((height - editorHeight) / 2),
        width: editorWidth,
        height: editorHeight
      }, true);
      
      try {
        if (!editorWindow.webContents.isDestroyed()) {
          editorWindow.webContents.send('show-home-view');
        }
      } catch (e) {
        console.log('[Editor] Could not send show-home-view:', e);
      }
    } else {
      // Editor view (recording): right side
      const recordingWidth = 420;
      editorWindow.setBounds({
        x: width - recordingWidth - 20,
        y: 20,
        width: recordingWidth,
        height: height - 40
      }, true);
    }
    return;
  }
  
  // Editor window - larger to accommodate sidebar
  const editorWidth = Math.floor(width * 0.55);
  const editorHeight = Math.floor(height * 0.8);
  editorWindow = new BrowserWindow({
    width: editorWidth,
    height: editorHeight,
    x: Math.floor((width - editorWidth) / 2),
    y: Math.floor((height - editorHeight) / 2),
    minWidth: 350,
    minHeight: 400,
    resizable: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  
  // Clear cache to ensure latest HTML is loaded
  editorWindow.webContents.session.clearCache();
  
  const filePath = path.join(__dirname, '../renderer/editor.html');
  console.log('[Editor] __dirname:', __dirname);
  console.log('[Editor] File path:', filePath);
  
  if (isDev) {
    editorWindow.loadURL('http://localhost:5173/editor.html');
  } else {
    editorWindow.loadFile(filePath);
  }
  
  // Log any load errors
  editorWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Editor] Failed to load:', errorCode, errorDescription);
  });
  
  editorWindow.webContents.on('did-finish-load', () => {
    console.log('[Editor] Page loaded successfully');
    
    // DevTools - open for debugging (disabled by default)
    // editorWindow?.webContents.openDevTools({ mode: 'detach' });
    
    // Small delay to ensure all JS event listeners are registered
    setTimeout(() => {
      // PRIORITY 1: If we have a pending note to load (from indicator/tray click during closed window)
      if (pendingNoteToLoad && editorWindow && !editorWindow.isDestroyed()) {
        console.log('[Editor] Loading pending note:', pendingNoteToLoad.noteId);
        editorWindow.webContents.send('open-note-from-indicator', {
          noteId: pendingNoteToLoad.noteId,
          isRecording: pendingNoteToLoad.isRecording,
          isPaused: pendingNoteToLoad.isPaused,
          recordingNoteId: pendingNoteToLoad.recordingNoteId
        });
        pendingNoteToLoad = null; // Clear after sending
      }
      // PRIORITY 2: If we have a current meeting and not showing home, send meeting info
      else if (currentMeeting && !showHome && editorWindow && !editorWindow.isDestroyed()) {
        console.log('[Editor] Sending current meeting info:', currentMeeting.title);
        editorWindow.webContents.send('set-meeting', currentMeeting);
      }
      // PRIORITY 3: Show home view
      else if (showHome && editorWindow && !editorWindow.isDestroyed()) {
        // Explicitly show home view
        editorWindow.webContents.send('show-home-view');
      }
    }, 100);
  });
  
  // CRITICAL: Hide window instead of closing for menu bar app behavior
  // This allows recording to continue in background and window to be quickly restored
  editorWindow.on('close', (event) => {
    // Prevent actual close if not force-quitting
    if (!forceQuit && editorWindow && !editorWindow.isDestroyed()) {
      event.preventDefault();
      editorWindow.hide();
      console.log('[Editor] Window hidden (not destroyed)');
      
      // Show indicator if recording is active
      if (isRecording && currentRecordingNoteId) {
        console.log('[Editor] Recording active, showing floating indicator');
        showMeetingIndicatorInactive(currentRecordingNoteId);
      }
    }
  });
  
  editorWindow.on('closed', () => {
    editorWindow = null;
    pendingNoteToLoad = null; // Clear any pending note load request
    
    // If recording is active, show the floating indicator
    if (isRecording && currentRecordingNoteId) {
      console.log('[Editor] Window closed during recording, showing indicator');
      showMeetingIndicatorInactive(currentRecordingNoteId);
    }
  });
  
  // Smart visibility for meeting indicator
  editorWindow.on('focus', () => {
    updateIndicatorVisibility();
  });
  
  editorWindow.on('blur', () => {
    updateIndicatorVisibility();
  });
  
  editorWindow.on('minimize', () => {
    updateIndicatorVisibility();
  });
  
  editorWindow.on('restore', () => {
    updateIndicatorVisibility();
  });
  
  editorWindow.on('hide', () => {
    updateIndicatorVisibility();
  });
  
  editorWindow.on('show', () => {
    updateIndicatorVisibility();
  });
}

// openTranscriptWidget removed - transcription now handled directly in editor

function openSettingsWindow() {
  // Open settings in the integrated panel instead of separate window
  openEditorWindow();
  setTimeout(() => {
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('show-settings');
    }
  }, 500);
}

// ============================================================================
// PERMISSIONS
// ============================================================================
async function checkPermissions() {
  const mic = systemPreferences.getMediaAccessStatus('microphone');
  const screen = systemPreferences.getMediaAccessStatus('screen');
  const accessibility = systemPreferences.isTrustedAccessibilityClient(false);
  
  // Also check using native module for more accurate ScreenCaptureKit permission
  const native = getNativeModule();
  const nativeScreenPermission = native ? native.checkScreenRecordingPermission() : false;
  
  console.log('[Permissions] Mic:', mic, '| Screen (system):', screen, '| Screen (native):', nativeScreenPermission, '| Accessibility:', accessibility);
  
  // Use native check for screen recording as it's more accurate for ScreenCaptureKit
  return {
    microphone: mic === 'granted',
    screenRecording: nativeScreenPermission,
    accessibility,
  };
}

async function requestPermissions() {
  // Request microphone
  await systemPreferences.askForMediaAccess('microphone');
  
  // Open system settings for screen recording and accessibility
  const perms = await checkPermissions();
  
  if (!perms.screenRecording) {
    exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"');
  }
  
  if (!perms.accessibility) {
    exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
  }
}

// ============================================================================
// NATIVE MODULE
// ============================================================================
let nativeModule: any = null;

function getNativeModule() {
  if (nativeModule) return nativeModule;
  
  try {
    nativeModule = require('ghost-native');
    console.log('[Native] Module loaded');
    
    // Set native module for AI router (for local LLM)
    setNativeModuleForAI(nativeModule);
    
    return nativeModule;
  } catch (e) {
    console.error('[Native] Failed to load:', e);
    return null;
  }
}


// ============================================================================
// IPC HANDLERS
// ============================================================================
function setupIPC() {
  // Check if recording is active
  ipcMain.handle('is-recording', () => {
    return isRecording;
  });
  
  // Meeting bar controls
  ipcMain.on('start-recording-from-bar', () => {
    console.log('[IPC] Start recording from bar');
    console.log('[IPC] currentMeeting:', currentMeeting?.title, 'windowId:', currentMeeting?.windowId);
    closeMeetingBar();
    
    setTimeout(async () => {
      await startRecording();
      
      // Wait for editor window to be fully loaded before positioning and sending recording mode
      const setupRecordingMode = () => {
        if (editorWindow && !editorWindow.isDestroyed()) {
          const primaryDisplay = screen.getPrimaryDisplay();
          const { width, height } = primaryDisplay.workAreaSize;
          
          // Recording mode: right side, full height, comfortable width
          const recordingWidth = 420;
          editorWindow.setBounds({
            x: width - recordingWidth - 20,
            y: 20,
            width: recordingWidth,
            height: height - 40
          }, true);
          
          // IMPORTANT: Send meeting info first, then recording mode
          // This ensures the renderer knows about the meeting before entering recording mode
          if (currentMeeting) {
            console.log('[IPC] Sending meeting info to renderer:', currentMeeting.title);
            editorWindow.webContents.send('set-meeting', currentMeeting);
          }
          
          // Small delay then send recording mode command
          setTimeout(() => {
            if (editorWindow && !editorWindow.isDestroyed()) {
              editorWindow.webContents.send('enter-recording-mode-from-main');
              console.log('[Editor] Entered recording mode from bar - positioned right');
            }
          }, 150);
        }
      };
      
      // Wait for editor to be ready (it was just opened by startRecording)
      if (editorWindow && !editorWindow.isDestroyed()) {
        if (editorWindow.webContents.isLoading()) {
          editorWindow.webContents.once('did-finish-load', () => {
            // Additional delay after load to ensure renderer JS is fully initialized
            setTimeout(setupRecordingMode, 300);
          });
        } else {
          // Already loaded, small delay to ensure renderer is ready
          setTimeout(setupRecordingMode, 300);
        }
      }
    }, 100);
  });
  
  ipcMain.on('close-meeting-bar', () => {
    closeMeetingBar();
  });
  
  ipcMain.on('close-editor', () => {
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.close();
    }
  });
  
  ipcMain.on('focus-editor-window', () => {
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.show();
      editorWindow.focus();
    }
  });
  
  ipcMain.on('minimize-editor', () => {
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.minimize();
    }
  });
  
  ipcMain.on('maximize-editor', () => {
    if (editorWindow && !editorWindow.isDestroyed()) {
      if (editorWindow.isMaximized()) {
        editorWindow.unmaximize();
      } else {
        editorWindow.maximize();
      }
    }
  });
  
  // Transcript widget IPC handlers removed - transcription in editor now
  
  ipcMain.on('show-editor', () => {
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.show();
      editorWindow.focus();
    }
  });
  
  // Permission checking IPC handlers
  ipcMain.handle('request-screen-recording-permission', async () => {
    const native = getNativeModule();
    if (native) {
      // Trigger the ScreenCaptureKit permission prompt
      native.triggerScreenRecordingPrompt();
    }
    
    // Return current status
    const perms = await checkPermissions();
    return perms.screenRecording;
  });
  
  ipcMain.on('open-screen-recording-settings', () => {
    // Open System Settings to Screen Recording
    const { shell } = require('electron');
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  });
  
  ipcMain.on('open-microphone-settings', () => {
    // Open System Settings to Microphone
    const { shell } = require('electron');
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
  });
  
  // Open Settings in a separate window
  ipcMain.on('open-settings-window', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus();
      return;
    }
    
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    
    settingsWindow = new BrowserWindow({
      width: 700,
      height: 600,
      minWidth: 600,
      minHeight: 500,
      x: Math.floor((screenWidth - 700) / 2),
      y: Math.floor((screenHeight - 600) / 2),
      frame: false,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 16 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });
    
    // Load settings page
    if (process.env.NODE_ENV === 'development') {
      settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));
    } else {
      settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));
    }
    
    settingsWindow.on('closed', () => {
      settingsWindow = null;
    });
  });
  
  // Close settings window
  ipcMain.on('close-settings-window', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
    
    // Notify editor window that settings closed (to re-check offline status)
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('settings-closed');
    }
  });
  
  // Notify editor when settings change (from settings window)
  ipcMain.on('notify-settings-changed', () => {
    console.log('[IPC] Settings changed, notifying editor window');
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('engine-changed');
    }
  });
  
  // Reposition window for recording mode (right side of screen)
  ipcMain.on('enter-recording-mode', () => {
    console.log('[IPC] enter-recording-mode received');
    
    // Small delay to ensure any window creation/rendering is complete
    setTimeout(() => {
      if (editorWindow && !editorWindow.isDestroyed()) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.workAreaSize;
        
        // Recording mode: right side, full height, comfortable width
        const recordingWidth = 420;
        const newBounds = {
          x: width - recordingWidth - 10, // 10px margin from edge
          y: 10, // Small margin from top
          width: recordingWidth,
          height: height - 20 // Small margin from bottom
        };
        
        console.log('[Editor] Setting recording mode bounds:', newBounds);
        editorWindow.setBounds(newBounds, true); // animate
        editorWindow.focus();
        
        console.log('[Editor] Entered recording mode - positioned right');
      } else {
        console.log('[Editor] Cannot enter recording mode - no editor window');
      }
    }, 100);
  });
  
  // Exit recording mode - restore center position
  ipcMain.on('exit-recording-mode', () => {
    if (editorWindow && !editorWindow.isDestroyed()) {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.workAreaSize;
      
      // Normal mode: centered, 55% width, 80% height
      const editorWidth = Math.floor(width * 0.55);
      const editorHeight = Math.floor(height * 0.8);
      editorWindow.setBounds({
        x: Math.floor((width - editorWidth) / 2),
        y: Math.floor((height - editorHeight) / 2),
        width: editorWidth,
        height: editorHeight
      }, true); // animate
      
      console.log('[Editor] Exited recording mode - centered');
    }
  });
  
  // transcript-from-widget removed - editor handles Deepgram directly now
  
  // Recording controls
  ipcMain.on('stop-recording', async () => {
    const audioPath = await stopRecording();
    hideMeetingIndicator(); // Hide the indicator when recording stops
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('recording-stopped', { audioPath });
    }
  });
  
  // Open note from meeting indicator click
  ipcMain.on('open-note-from-indicator', (_, noteId: string) => {
    console.log('[MeetingIndicator] Opening note:', noteId, 'isRecording:', isRecording, 'currentRecordingNoteId:', currentRecordingNoteId);
    
    const targetNoteId = noteId || currentRecordingNoteId;
    
    // CRITICAL: Force save the current transcript to DB BEFORE opening
    // This ensures selectNote will find the note with current transcript
    if (isRecording && targetNoteId && currentTranscriptSegments.length > 0) {
      // CRITICAL: Only save FINAL segments, not interim ones
      const finalSegments = currentTranscriptSegments.filter(seg => seg.isFinal !== false);
      console.log('[MeetingIndicator] Force saving note before open:', targetNoteId, 'total:', currentTranscriptSegments.length, 'final:', finalSegments.length);
      try {
        databaseService.saveNote({
          id: targetNoteId,
          title: currentMeeting?.title || 'Voice Note',
          provider: currentMeeting?.provider || 'manual',
          date: new Date().toISOString(),
          transcript: JSON.stringify(finalSegments),
          notes: '',
          enhancedNotes: null,
          audioPath: null,
          calendarEventId: null,
          startTime: null,
          folderId: null,
          templateId: null
        });
        console.log('[MeetingIndicator] ✅ Force saved note before opening');
      } catch (err) {
        console.error('[MeetingIndicator] Failed to force save:', err);
      }
    }
    
    // Hide indicator first
    if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
      meetingIndicatorWindow.hide();
    }
    
    // Show and focus the editor window
    if (editorWindow && !editorWindow.isDestroyed()) {
      // Tell editor to load this specific note AND sync recording state
      editorWindow.webContents.send('open-note-from-indicator', {
        noteId: targetNoteId,
        isRecording: isRecording,
        isPaused: isRecordingPaused,
        recordingNoteId: currentRecordingNoteId
      });
      
      console.log('[MeetingIndicator] Sent open-note-from-indicator with:', {
        noteId: targetNoteId,
        isRecording: isRecording,
        isPaused: isRecordingPaused,
        recordingNoteId: currentRecordingNoteId
      });
      
      // Show dock icon
      if (process.platform === 'darwin' && app.dock) {
        app.dock.show();
      }
      
      // Simply show the window - don't force focus behavior
      editorWindow.show();
      
      // Use setImmediate to let macOS handle focus naturally, then bring to front
      setImmediate(() => {
        if (editorWindow && !editorWindow.isDestroyed()) {
          editorWindow.moveTop(); // Bring to front without aggressive focus grab
        }
      });
    } else {
      // If no editor window, open one and load the note
      // Set pending note to load - it will be sent after window finishes loading
      if (targetNoteId) {
        console.log('[MeetingIndicator] Setting pending note to load:', targetNoteId);
        pendingNoteToLoad = {
          noteId: targetNoteId,
          isRecording: isRecording,
          isPaused: isRecordingPaused,
          recordingNoteId: currentRecordingNoteId
        };
      }
      openEditorWindow(false); // false = editor view, not home
    }
  });
  
  // Update meeting indicator with noteId (called when note is created during recording)
  ipcMain.on('update-indicator-note', (_, data: { noteId: string; title: string }) => {
    console.log('[MeetingIndicator] Updating note info:', data);
    currentRecordingNoteId = data.noteId;
    if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
      meetingIndicatorWindow.webContents.send('set-note-info', {
        noteId: data.noteId,
      });
    }
  });
  
  // Move indicator window (for drag)
  ipcMain.on('move-indicator-window', (_, { dx, dy }: { dx: number; dy: number }) => {
    if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
      const bounds = meetingIndicatorWindow.getBounds();
      meetingIndicatorWindow.setBounds({
        x: bounds.x + dx,
        y: bounds.y + dy,
        width: bounds.width,
        height: bounds.height,
      });
      // Save position
      indicatorPosition = { x: bounds.x + dx, y: bounds.y + dy };
    }
  });
  
  // Pause recording
  ipcMain.on('pause-recording', () => {
    if (!isRecording || isRecordingPaused) return;
    
    console.log('[Recording] Pausing...');
    isRecordingPaused = true;
    pauseStartTime = Date.now();
    
    // Pause audio capture
    if (audioEngine) {
      audioEngine.pauseRecording();
    }
    
    // Pause transcription
    if (transcriptionRouter) {
      transcriptionRouter.pauseStreaming();
    }
    
    // Update indicator
    if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
      meetingIndicatorWindow.webContents.send('set-paused', true);
    }
    
    // Notify editor
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('recording-paused', true);
    }
    
    console.log('[Recording] ⏸️ Paused');
  });
  
  // Resume recording
  ipcMain.on('resume-recording', () => {
    if (!isRecording || !isRecordingPaused) return;
    
    console.log('[Recording] Resuming...');
    isRecordingPaused = false;
    
    // Resume audio capture
    if (audioEngine) {
      audioEngine.resumeRecording();
    }
    
    // Resume transcription
    if (transcriptionRouter) {
      transcriptionRouter.resumeStreaming();
    }
    
    // Update indicator
    if (meetingIndicatorWindow && !meetingIndicatorWindow.isDestroyed()) {
      meetingIndicatorWindow.webContents.send('set-paused', false);
    }
    
    // Notify editor
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('recording-paused', false);
    }
    
    console.log('[Recording] ▶️ Resumed');
  });
  
  // Get pause state
  ipcMain.handle('is-recording-paused', () => {
    return isRecordingPaused;
  });
  
  // Get full recording state and accumulated segments (for editor sync after reopen)
  ipcMain.handle('get-recording-state', () => {
    // CRITICAL: Only return FINAL segments, not interim ones
    const finalSegments = currentTranscriptSegments.filter(seg => seg.isFinal !== false);
    return {
      isRecording,
      isPaused: isRecordingPaused,
      noteId: currentRecordingNoteId,
      segments: finalSegments,
      elapsedSeconds: recordingElapsedSeconds,
    };
  });
  
  // Stop Deepgram streaming (called from renderer)
  ipcMain.on('stop-deepgram-stream', () => {
    console.log('[IPC] stop-deepgram-stream received');
    if (transcriptionRouter) {
      transcriptionRouter.stopStreaming();
    }
  });
  
  // Manual mic recording (when no meeting detected, or restart after stop)
  ipcMain.on('start-manual-recording', async (_, data: { title: string; noteId?: string }) => {
    console.log('[Ghost] Starting manual recording:', data.title, 'noteId:', data.noteId);
    
    if (isRecording) {
      console.log('[Ghost] Already recording');
      return;
    }
    
    // Create a virtual meeting info for manual recording
    currentMeeting = {
      provider: 'manual',
      title: data.title || 'Voice Note',
      pid: 0,
      isBrowser: false,
    };
    currentTranscript = [];
    currentTranscriptSegments = [];
    currentRecordingNoteId = data.noteId || null;
    recordingStartTime = Date.now();
    
    try {
      // Start audio capture
      if (audioEngine) {
        await audioEngine.startRecording(0, 'manual');
        console.log('[Ghost] Audio capture started');
      }
      
      isRecording = true;
      isRecordingPaused = false;
      startElapsedTimeTracking(); // Start tracking elapsed time
      startAutoSaveInterval(); // Auto-save transcript periodically
      updateTrayMenu();
      
      // Show the always-on-top meeting indicator
      // (noteId might be empty for new unsaved notes, but we'll update it when note is saved)
      showMeetingIndicator(currentRecordingNoteId || '');
      
      // Start transcription streaming to Deepgram
      if (transcriptionRouter) {
        transcriptionRouter.setNativeModule(getNativeModule());
        transcriptionRouter.setOnTranscript((segment) => {
          // Enrich segment with speakerName for persistence
          const enrichedSegment = {
            ...segment,
            speakerName: segment.isYou ? 'You' : (segment.speaker !== null ? `Speaker ${segment.speaker + 1}` : 'Them'),
          };
          
          try {
            if (editorWindow && !editorWindow.isDestroyed() && editorWindow.webContents && !editorWindow.webContents.isDestroyed()) {
              editorWindow.webContents.send('transcript-segment', enrichedSegment);
            }
          } catch (err) {
            // Silently ignore - window was closed/disposed during send
          }
          
          // Store in currentTranscript for AI notes (string format)
          const label = segment.isYou ? '[You]' : (segment.speaker !== null ? `[Speaker ${segment.speaker + 1}]` : '');
          currentTranscript.push(label ? `${label} ${segment.text}` : segment.text);
          // Store full segment for editor sync when window reopens
          currentTranscriptSegments.push(enrichedSegment);
        });
        transcriptionRouter.startStreaming();
        console.log('[Ghost] Transcription streaming started');
      }
      
      // Tell editor transcription has started
      if (editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send('start-transcription');
      }
      
      console.log('[Ghost] Manual recording started successfully');
    } catch (e) {
      console.error('[Ghost] Failed to start manual recording:', e);
      isRecording = false;
      stopAutoSaveInterval();
      hideMeetingIndicator();
    }
  });
  
  ipcMain.on('save-note', async (_, data: { id?: string; title?: string; notes?: string; enhancedNotes?: string; transcript?: any[]; audioPath?: string; calendarEventId?: string; startTime?: string; folderId?: string; templateId?: string; attendees?: { email: string; name?: string; self?: boolean }[] }) => {
    // Use data from editor if provided, otherwise fall back to current state
    // For date: use meeting's scheduled time if available, otherwise use now
    // This ensures notes for future meetings show under the correct day
    const meetingDate = data?.startTime 
      ? new Date(data.startTime).toISOString()
      : new Date().toISOString();
    
    let title = data?.title || currentMeeting?.title || 'Untitled Meeting';
    const transcriptData = data?.transcript || currentTranscript;
    
    // Check if title is generic and we have transcript to generate from
    const genericTitles = ['untitled meeting', 'window', 'google chrome', 'chrome', 'safari', 'meeting notes'];
    const isGenericTitle = genericTitles.includes(title.toLowerCase()) || title.toLowerCase().startsWith('google meet ') || title.toLowerCase().startsWith('zoom ');
    
    if (isGenericTitle && transcriptData.length > 0 && openaiService?.hasApiKey()) {
      console.log('[Notes] Title is generic, attempting AI generation...');
      try {
        // Convert transcript to string array
        const transcriptStrings = transcriptData.map((item: any) => 
          typeof item === 'string' ? item : item.text
        );
        // Get language settings for title generation
        const langSettings = store.get('langSettings', { transcriptionLang: 'en', aiNotesLang: 'same', autoDetect: false }) as any;
        const titleLang = langSettings.aiNotesLang === 'same' ? langSettings.transcriptionLang : langSettings.aiNotesLang;
        const aiTitle = await openaiService.generateMeetingTitle(transcriptStrings, titleLang);
        if (aiTitle) {
          // Remove any quotes the LLM might have added
          title = aiTitle.replace(/^["']|["']$/g, '');
          console.log('[Notes] AI generated title:', title);
        }
      } catch (e) {
        console.error('[Notes] AI title generation failed:', e);
      }
    }
    
    // Use the provided folder ID (no auto-assignment to default folder)
    const assignedFolderId = data?.folderId;
    
    // Load existing note to preserve fields not being updated
    const noteId = data?.id || Date.now().toString();
    const existingNote = data?.id ? loadNote(data.id) : null;
    
    // Extract people and companies from attendees if provided
    let people = existingNote?.people || [];
    let companies = existingNote?.companies || [];
    
    if (data?.attendees && data.attendees.length > 0) {
      const excludeDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'mail.com'];
      const seenCompanies = new Set<string>();
      people = [];
      companies = [];
      
      data.attendees.forEach((attendee: any) => {
        if (attendee.self) return;
        
        // Extract person name (displayName from calendar API or name from custom)
        const personName = attendee.displayName || attendee.name;
        if (personName) {
          people.push(personName);
        } else if (attendee.email) {
          const name = attendee.email.split('@')[0].replace(/[._]/g, ' ');
          const formattedName = name.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          people.push(formattedName);
        }
        
        // Extract company from email domain
        if (attendee.email) {
          const domain = attendee.email.split('@')[1]?.toLowerCase();
          if (domain && !excludeDomains.includes(domain) && !seenCompanies.has(domain)) {
            seenCompanies.add(domain);
            const companyName = domain.split('.')[0];
            const formattedCompany = companyName.charAt(0).toUpperCase() + companyName.slice(1);
            companies.push(formattedCompany);
          }
        }
      });
      console.log('[Notes] Extracted from attendees - people:', people, 'companies:', companies);
    }
    
    const noteData = {
      id: noteId,
      title: title,
      provider: existingNote?.provider || currentMeeting?.provider || 'manual',
      date: existingNote?.date || meetingDate,
      transcript: transcriptData,
      notes: data?.notes ?? existingNote?.notes ?? '',
      enhancedNotes: data?.enhancedNotes ?? existingNote?.enhancedNotes,
      audioPath: data?.audioPath || existingNote?.audioPath,
      calendarEventId: data?.calendarEventId || existingNote?.calendarEventId,
      startTime: data?.startTime || existingNote?.startTime,
      folderId: assignedFolderId,
      templateId: data?.templateId ?? existingNote?.templateId,
      people: people,
      companies: companies,
    };
    
    // Save the note (folderId is already part of noteData)
    const notePath = saveNote(noteData as Note);
    console.log('[Notes] Saved note:', notePath);
    if (assignedFolderId) {
      console.log('[Notes] Assigned to folder:', assignedFolderId);
    }
    
    // Index for vector search (async, don't block)
    if (transcriptData && transcriptData.length > 0) {
      const vectorService = getVectorSearchService();
      if (vectorService.isReady()) {
        vectorService.indexNote(noteData.id, title, transcriptData, assignedFolderId || null, noteData.notes || '')
          .then(indexed => {
            if (indexed) console.log('[Notes] Indexed for vector search');
          })
          .catch(err => console.error('[Notes] Vector index error:', err));
      }
    }
    
    // Notify editor window
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('note-saved', noteData);
      editorWindow.webContents.send('notes-updated');
    }
  });
  
  ipcMain.on('close-transcript', () => {
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.hide();
    }
  });
  
  // Notes
  ipcMain.handle('get-notes', () => loadNotes());
  ipcMain.handle('get-note', (_, id: string) => loadNote(id));
  ipcMain.handle('delete-note', (_, id: string) => deleteNote(id));
  
  // Update note with AI-suggested folder (suggestion stored temporarily in memory, actual folder set when user confirms)
  ipcMain.handle('update-note-suggestion', (_, noteId: string, suggestedFolderId: string, confidence: 'high' | 'medium' | 'low', reason?: string) => {
    // Note: Suggestions are now handled in the UI and applied via folder assignment
    console.log('[Notes] Suggestion for note:', noteId, '-> folder:', suggestedFolderId, 'confidence:', confidence);
    return true;
  });
  
  // Backfill people/companies for existing notes from calendar events
  ipcMain.handle('backfill-people-companies', async () => {
    const notes = loadNotes();
    let updated = 0;
    
    for (const note of notes) {
      // Skip if already has people/companies
      if ((note.people && note.people.length > 0) || (note.companies && note.companies.length > 0)) {
        continue;
      }
      
      // Try to get attendees from calendar event if linked
      if (note.calendarEventId && calendarService?.isConnected()) {
        try {
          const events = await calendarService.getEvents();
          const event = events.find(e => e.id === note.calendarEventId);
          
          if (event?.attendees && event.attendees.length > 0) {
            const excludeDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'mail.com'];
            const seenCompanies = new Set<string>();
            const people: string[] = [];
            const companies: string[] = [];
            
            event.attendees.forEach(attendee => {
              if (attendee.self) return;
              
              // Extract person name
              const personName = attendee.displayName;
              if (personName) {
                people.push(personName);
              } else if (attendee.email) {
                const name = attendee.email.split('@')[0].replace(/[._]/g, ' ');
                const formattedName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                people.push(formattedName);
              }
              
              // Extract company from email domain
              if (attendee.email) {
                const domain = attendee.email.split('@')[1]?.toLowerCase();
                if (domain && !excludeDomains.includes(domain) && !seenCompanies.has(domain)) {
                  seenCompanies.add(domain);
                  const companyName = domain.split('.')[0];
                  const formattedCompany = companyName.charAt(0).toUpperCase() + companyName.slice(1);
                  companies.push(formattedCompany);
                }
              }
            });
            
            if (people.length > 0 || companies.length > 0) {
              // Add people and companies to database
              people.forEach(person => databaseService.addPersonToNote(note.id, person));
              companies.forEach(company => databaseService.addCompanyToNote(note.id, company));
              updated++;
              console.log('[Notes] Backfilled note', note.id, 'with', people.length, 'people,', companies.length, 'companies');
            }
          }
        } catch (e) {
          console.error('[Notes] Failed to backfill note', note.id, e);
        }
      }
    }
    
    console.log('[Notes] Backfill complete, updated', updated, 'notes');
    return updated;
  });
  
  // Get all people across notes with their note counts, emails, and last note date
  ipcMain.handle('get-all-people', () => {
    return databaseService.getAllPeople();
  });
  
  // Get all companies across notes with their note counts, domains, and last note date
  ipcMain.handle('get-all-companies', () => {
    return databaseService.getAllCompanies();
  });
  
  // Get notes filtered by person
  ipcMain.handle('get-notes-by-person', (_, personName: string) => {
    const dbNotes = databaseService.getNotesByPerson(personName);
    return dbNotes.map(n => ({
      ...n,
      transcript: JSON.parse(n.transcript || '[]'),
      people: databaseService.getPeopleForNote(n.id).map(p => p.name),
      companies: databaseService.getCompaniesForNote(n.id).map(c => c.name)
    }));
  });
  
  // Get notes filtered by company
  ipcMain.handle('get-notes-by-company', (_, companyName: string) => {
    const dbNotes = databaseService.getNotesByCompany(companyName);
    return dbNotes.map(n => ({
      ...n,
      transcript: JSON.parse(n.transcript || '[]'),
      people: databaseService.getPeopleForNote(n.id).map(p => p.name),
      companies: databaseService.getCompaniesForNote(n.id).map(c => c.name)
    }));
  });
  
  // Full-text search across notes
  ipcMain.handle('search-notes', (_, query: string) => {
    const results = databaseService.searchNotes(query);
    return results.map(n => ({
      ...n,
      transcript: JSON.parse(n.transcript || '[]'),
      people: databaseService.getPeopleForNote(n.id).map(p => p.name),
      companies: databaseService.getCompaniesForNote(n.id).map(c => c.name)
    }));
  });
  
  // Global search across notes, people, companies, and folders
  ipcMain.handle('global-search', (_, query: string) => {
    const noteResults = databaseService.searchNotes(query, 10);
    const notes = noteResults.map(n => ({
      ...n,
      transcript: JSON.parse(n.transcript || '[]'),
      people: databaseService.getPeopleForNote(n.id).map(p => p.name),
      companies: databaseService.getCompaniesForNote(n.id).map(c => c.name)
    }));
    
    return {
      notes,
      people: databaseService.searchPeople(query, 5),
      companies: databaseService.searchCompanies(query, 5),
      folders: databaseService.searchFolders(query, 5)
    };
  });
  
  // Extract people and companies from calendar attendees
  // People = attendee names, Companies = email domains
  ipcMain.handle('extract-people-companies', async (_, data: { noteId: string; attendees?: { email: string; name?: string; self?: boolean }[] }) => {
    const note = loadNote(data.noteId);
    if (!note) return null;
    
    const attendees = data.attendees || [];
    const people: string[] = [];
    const companies: string[] = [];
    const seenCompanies = new Set<string>();
    
    // Common email providers to exclude from company extraction
    const excludeDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'mail.com'];
    
    attendees.forEach(attendee => {
      // Skip self
      if (attendee.self) return;
      
      // Extract person name
      if (attendee.name) {
        people.push(attendee.name);
      } else if (attendee.email) {
        // Use email prefix as name if no name provided
        const name = attendee.email.split('@')[0].replace(/[._]/g, ' ');
        // Capitalize first letter of each word
        const formattedName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        people.push(formattedName);
      }
      
      // Extract company from email domain
      if (attendee.email) {
        const domain = attendee.email.split('@')[1]?.toLowerCase();
        if (domain && !excludeDomains.includes(domain) && !seenCompanies.has(domain)) {
          seenCompanies.add(domain);
          // Convert domain to company name (e.g., google.com -> Google)
          const companyName = domain.split('.')[0];
          const formattedCompany = companyName.charAt(0).toUpperCase() + companyName.slice(1);
          companies.push(formattedCompany);
        }
      }
    });
    
    // Add people and companies to database
    people.forEach(person => databaseService.addPersonToNote(data.noteId, person));
    companies.forEach(company => databaseService.addCompanyToNote(data.noteId, company));
    console.log('[Notes] Updated note with people/companies:', { people, companies });
    
    // Notify frontend
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('people-companies-updated');
    }
    
    return { people, companies };
  });
  
  // Settings
  ipcMain.handle('get-deepgram-key', () => transcriptionService?.getApiKey() ?? null);
  ipcMain.handle('save-deepgram-key', (_, key: string) => {
    const result = transcriptionService?.saveApiKey(key) ?? false;
    // Notify editor of config change
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('config-status-changed');
    }
    return result;
  });
  ipcMain.handle('has-deepgram-key', () => transcriptionService?.hasApiKey() ?? false);
  ipcMain.handle('clear-deepgram-key', () => {
    transcriptionService?.clearApiKey?.();
    // Notify editor of config change
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('config-status-changed');
    }
    return true;
  });
  
  // Permissions
  ipcMain.handle('check-permissions', checkPermissions);
  ipcMain.handle('request-permissions', requestPermissions);
  
  // Calendar (PKCE flow - no secrets needed)
  ipcMain.handle('calendar-is-connected', () => {
    console.log('[IPC] calendar-is-connected called');
    const connected = calendarService?.isConnected() ?? false;
    console.log('[IPC] calendar-is-connected returning:', connected);
    console.log('[IPC] calendarService exists:', !!calendarService);
    return connected;
  });
  ipcMain.handle('calendar-has-client-id', () => {
    console.log('[IPC] calendar-has-client-id called');
    return calendarService?.hasClientId() ?? false;
  });
  ipcMain.handle('calendar-connect', async () => {
    console.log('[IPC] calendar-connect called');
    if (!calendarService) {
      console.log('[IPC] No calendar service!');
      return false;
    }
    const connected = await calendarService.authenticate();
    console.log('[IPC] calendar-connect result:', connected);
    if (connected) {
      calendarService.startReminderService(showMeetingReminder);
    }
    return connected;
  });
  ipcMain.handle('calendar-disconnect', async () => {
    await calendarService?.disconnect();
    return true;
  });
  ipcMain.handle('calendar-get-events', async () => {
    if (!calendarService?.isConnected()) return [];
    return await calendarService.fetchEvents();
  });
  
  ipcMain.handle('calendar-get-list', async () => {
    if (!calendarService?.isConnected()) return [];
    return await calendarService.fetchCalendarList();
  });
  
  ipcMain.handle('calendar-set-selected', async (_, calendarId: string, selected: boolean) => {
    calendarService?.setCalendarSelected(calendarId, selected);
    
    // Notify editor window to refresh calendar events
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('calendar-selection-changed');
    }
    
    return true;
  });
  
  // Calendar Token Testing (for debugging refresh flow)
  ipcMain.handle('calendar-force-expire-token', () => {
    console.log('[IPC] Force-expire token requested');
    return calendarService?.forceExpireToken() || false;
  });
  
  ipcMain.handle('calendar-get-token-status', () => {
    console.log('[IPC] Get token status requested');
    return calendarService?.getTokenStatus() || { isExpired: true, expiresIn: null, hasRefreshToken: false };
  });
  
  // ============================================================================
  // FOLDERS (using SQLite database)
  // ============================================================================
  
  ipcMain.handle('folders-get-all', () => {
    const folders = databaseService.getAllFolders();
    // Add note counts to each folder
    return folders.map(folder => ({
      ...folder,
      noteCount: databaseService.getNotesInFolder(folder.id).length
    }));
  });
  
  ipcMain.handle('folders-get', (_, folderId: string) => {
    const folders = databaseService.getAllFolders();
    return folders.find(f => f.id === folderId) || null;
  });
  
  ipcMain.handle('folders-create', (_, name: string, icon?: string, color?: string, isDefault?: boolean, description?: string) => {
    const folder = {
      id: `folder-${Date.now()}`,
      name,
      icon: icon || '📁',
      color: color || '#6366f1',
      description: description || '',
      createdAt: new Date().toISOString()
    };
    databaseService.saveFolder(folder);
    return folder;
  });
  
  ipcMain.handle('folders-update', (_, folderId: string, updates: { name?: string; icon?: string; color?: string; description?: string }) => {
    const folders = databaseService.getAllFolders();
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return null;
    
    const updatedFolder = {
      ...folder,
      ...updates
    };
    databaseService.saveFolder(updatedFolder);
    return updatedFolder;
  });
  
  ipcMain.handle('folders-get-default', () => {
    // No default folder concept in new system
    return null;
  });
  
  ipcMain.handle('folders-set-default', (_, folderId: string) => {
    // No default folder concept in new system
    return true;
  });
  
  ipcMain.handle('folders-delete', (_, folderId: string) => {
    databaseService.deleteFolder(folderId);
    return true;
  });
  
  // Delete folder AND all notes in it
  ipcMain.handle('folders-delete-with-notes', async (_, folderId: string) => {
    // Get all notes in the folder
    const notesInFolder = databaseService.getNotesInFolder(folderId);
    
    // Delete each note
    for (const note of notesInFolder) {
      deleteNote(note.id);
    }
    
    // Delete the folder
    databaseService.deleteFolder(folderId);
    return true;
  });
  
  ipcMain.handle('folders-add-note', (_, folderId: string, noteId: string) => {
    databaseService.addNoteToFolder(noteId, folderId);
    return true;
  });
  
  ipcMain.handle('folders-remove-note', (_, folderId: string, noteId: string) => {
    databaseService.removeNoteFromFolder(noteId);
    return true;
  });
  
  ipcMain.handle('folders-get-notes', (_, folderId: string) => {
    // Get notes from database
    const dbNotes = databaseService.getNotesInFolder(folderId);
    return dbNotes.map(n => ({
      ...n,
      transcript: JSON.parse(n.transcript || '[]'),
      enhancedNotes: n.enhancedNotes ?? undefined,
      people: databaseService.getPeopleForNote(n.id).map(p => p.name),
      companies: databaseService.getCompaniesForNote(n.id).map(c => c.name)
    }));
  });
  
  ipcMain.handle('folders-get-for-note', (_, noteId: string) => {
    const note = databaseService.getNote(noteId);
    if (!note || !note.folderId) return null;
    const folders = databaseService.getAllFolders();
    return folders.find(f => f.id === note.folderId) || null;
  });
  
  // ============================================================================
  // VECTOR SEARCH & FOLDER AI Q&A
  // ============================================================================
  
  const vectorSearchService = getVectorSearchService();
  
  // Initialize vector search with OpenAI API key
  ipcMain.handle('vector-search-init', async () => {
    console.log('[VectorSearch] Init called, openaiService exists:', !!openaiService);
    console.log('[VectorSearch] hasApiKey:', openaiService?.hasApiKey());
    const apiKey = openaiService?.getApiKey();
    console.log('[VectorSearch] apiKey exists:', !!apiKey);
    if (!apiKey) {
      console.log('[VectorSearch] No API key configured');
      return false;
    }
    return await vectorSearchService.initialize(apiKey);
  });
  
  ipcMain.handle('vector-search-ready', () => {
    return vectorSearchService.isReady();
  });
  
  ipcMain.handle('vector-search-index-note', async (_, noteId: string, noteTitle: string, transcript: any[], folderId: string | null, userNotes?: string) => {
    return await vectorSearchService.indexNote(noteId, noteTitle, transcript, folderId, userNotes);
  });
  
  ipcMain.handle('vector-search-remove-note', async (_, noteId: string) => {
    return await vectorSearchService.removeNote(noteId);
  });
  
  ipcMain.handle('vector-search-query', async (_, query: string, folderId?: string, limit?: number) => {
    return await vectorSearchService.search(query, folderId, limit);
  });
  
  ipcMain.handle('vector-search-stats', async () => {
    return await vectorSearchService.getStats();
  });
  
  // Reindex all existing notes (useful after creating test data or first setup)
  ipcMain.handle('vector-search-reindex-all', async () => {
    // Initialize with OpenAI key if available, but works without it for local embeddings
    const apiKey = openaiService?.getApiKey();
    await vectorSearchService.initialize(apiKey || undefined);
    
    if (!vectorSearchService.isReady()) {
      console.log('[VectorSearch] Not ready for reindex');
      return { indexed: 0, errors: 0, engine: 'none' };
    }
    
    const engine = vectorSearchService.getEmbeddingEngine();
    console.log('[VectorSearch] Reindexing with engine:', engine);
    
    // Get all notes
    const notesPath = path.join(app.getPath('userData'), 'notes');
    if (!fs.existsSync(notesPath)) {
      return { indexed: 0, errors: 0, engine };
    }
    
    const noteFiles = fs.readdirSync(notesPath).filter(f => f.endsWith('.json'));
    console.log('[VectorSearch] Reindexing', noteFiles.length, 'notes...');
    
    let indexed = 0;
    let errors = 0;
    
    for (const file of noteFiles) {
      try {
        const notePath = path.join(notesPath, file);
        const noteData = JSON.parse(fs.readFileSync(notePath, 'utf-8'));
        
        if (noteData.transcript && noteData.transcript.length > 0) {
          const success = await vectorSearchService.indexNote(
            noteData.id,
            noteData.title || 'Untitled',
            noteData.transcript,
            noteData.folderId || null,
            noteData.notes || ''
          );
          if (success) indexed++;
          else errors++;
        }
      } catch (err) {
        console.error('[VectorSearch] Error indexing note:', file, err);
        errors++;
      }
    }
    
    console.log('[VectorSearch] ✅ Reindex complete:', indexed, 'indexed,', errors, 'errors');
    return { indexed, errors, engine };
  });
  
  // Folder search with LLM synthesis
  ipcMain.handle('folder-search-llm', async (_, data: { question: string, context: string, folderId: string }) => {
    console.log('[FolderSearch] LLM query:', data.question.substring(0, 50) + '...');
    
    try {
      const apiKey = openaiService?.getApiKey();
      if (!apiKey) {
        return { answer: null, error: 'No API key configured' };
      }
      
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey });
      
      const systemPrompt = `You are a helpful assistant that answers questions based on meeting transcripts.

INSTRUCTIONS:
- Answer the question using ONLY the provided transcript excerpts
- Be concise and direct
- If the information isn't in the transcripts, say "I couldn't find specific information about that in these notes."
- Use bullet points for lists
- Cite which meeting the information came from when possible (shown in brackets like [From "Meeting Name"])`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Based on these meeting transcript excerpts:\n\n${data.context}\n\nQuestion: ${data.question}\n\nAnswer:` }
        ],
        temperature: 0.3,
        max_tokens: 600
      });
      
      const answer = response.choices[0]?.message?.content;
      return { answer };
    } catch (err: any) {
      console.error('[FolderSearch] LLM error:', err);
      return { answer: null, error: err.message };
    }
  });
  
  // Folder AI Q&A - combines vector search with LLM
  ipcMain.handle('folder-ai-ask', async (_, folderId: string, question: string) => {
    console.log('[FolderAI] Question for folder', folderId, ':', question.substring(0, 50) + '...');
    
    try {
      // Get relevant context from folder transcripts
      const context = await vectorSearchService.getFolderContext(question, folderId, 5);
      
      if (!context) {
        return { 
          answer: "I couldn't find any relevant information in this folder's transcripts. Make sure there are notes with transcripts in this folder.",
          sources: []
        };
      }
      
      // Use OpenAI to answer the question with the context
      const apiKey = openaiService?.getApiKey();
      if (!apiKey) {
        return { 
          answer: "Please configure your OpenAI API key in Settings to use AI features.",
          sources: []
        };
      }
      
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey });
      
      const systemPrompt = `You are a helpful assistant that answers questions based on meeting transcripts. 
Use ONLY the provided transcript excerpts to answer the question. 
If the information isn't in the transcripts, say so.
Be concise and cite which meeting the information came from when possible.`;

      const userPrompt = `Based on these meeting transcript excerpts:

${context}

Question: ${question}

Answer:`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 500
      });
      
      const answer = response.choices[0]?.message?.content || "I couldn't generate an answer.";
      
      // Get sources (search results) to show which notes were used
      const sources = await vectorSearchService.search(question, folderId, 3);
      
      return { 
        answer,
        sources: sources.map(s => ({ noteId: s.noteId, noteTitle: s.noteTitle }))
      };
    } catch (err: any) {
      console.error('[FolderAI] Error:', err);
      return { 
        answer: `Error: ${err.message}`,
        sources: []
      };
    }
  });
  
  // Theme
  ipcMain.handle('theme-get', () => {
    return store.get('theme', 'system');
  });
  
  ipcMain.handle('theme-set', (_, theme: string) => {
    store.set('theme', theme);
    // Apply theme to all windows
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(win => {
      win.webContents.send('theme-changed', theme);
    });
    return true;
  });
  
  // Notification Settings
  ipcMain.handle('notif-get-settings', () => {
    return store.get('notifSettings', {
      scheduledMeetings: true,
      autoDetectedMeetings: true,
      mutedApps: []
    });
  });
  
  ipcMain.handle('notif-save-settings', (_, settings: any) => {
    store.set('notifSettings', settings);
    return true;
  });
  
  // Note Templates
  ipcMain.handle('templates-get-all', () => {
    const { getTemplateService } = require('./templates');
    return getTemplateService().getTemplates();
  });
  
  ipcMain.handle('templates-get', (_, id: string) => {
    const { getTemplateService } = require('./templates');
    return getTemplateService().getTemplate(id);
  });
  
  ipcMain.handle('templates-get-default', () => {
    const { getTemplateService } = require('./templates');
    return getTemplateService().getDefaultTemplate();
  });
  
  ipcMain.handle('templates-create', (_, template: any) => {
    const { getTemplateService } = require('./templates');
    return getTemplateService().createTemplate(template);
  });
  
  ipcMain.handle('templates-update', (_, id: string, updates: any) => {
    const { getTemplateService } = require('./templates');
    return getTemplateService().updateTemplate(id, updates);
  });
  
  ipcMain.handle('templates-delete', (_, id: string) => {
    const { getTemplateService } = require('./templates');
    return getTemplateService().deleteTemplate(id);
  });
  
  ipcMain.handle('templates-set-default', (_, id: string) => {
    const { getTemplateService } = require('./templates');
    return getTemplateService().setDefaultTemplate(id);
  });
  
  // Language Settings
  ipcMain.handle('lang-get-settings', () => {
    return store.get('langSettings', {
      transcriptionLang: 'en',
      aiNotesLang: 'same',
      autoDetect: false
    });
  });
  
  ipcMain.handle('lang-save-settings', (_, settings: any) => {
    store.set('langSettings', settings);
    // Notify transcription router of language change (only applies to Deepgram)
    if (transcriptionRouter) {
      transcriptionRouter.setLanguage(settings.transcriptionLang, settings.autoDetect);
    }
    return true;
  });
  
  // Reminder
  ipcMain.on('dismiss-reminder', () => {
    closeReminder();
  });
  
  // Open folders
  // Recordings folder removed - audio no longer saved
  ipcMain.on('open-notes', () => shell.openPath(app.getPath('userData')));
  
  // ============================================================================
  // OPENAI IPC HANDLERS
  // ============================================================================
  ipcMain.handle('openai-has-key', () => {
    const hasKey = openaiService?.hasApiKey() ?? false;
    console.log('[OpenAI] has-key check:', hasKey);
    return hasKey;
  });
  
  ipcMain.handle('openai-get-key', () => {
    return openaiService?.getApiKey() ?? null;
  });
  
  ipcMain.handle('openai-save-key', (_, key: string) => {
    const result = openaiService?.saveApiKey(key) ?? false;
    // Notify editor of config change
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('config-status-changed');
    }
    return result;
  });
  
  ipcMain.handle('openai-clear-key', () => {
    console.log('[OpenAI] Clear key called, hasKey before:', openaiService?.hasApiKey());
    openaiService?.clearApiKey();
    console.log('[OpenAI] Clear key done, hasKey after:', openaiService?.hasApiKey());
    // Notify editor of config change
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('config-status-changed');
    }
    return true;
  });
  
  ipcMain.handle('openai-generate-notes', async (_, data: { transcript: string[], meetingTitle: string, existingNotes: string }) => {
    if (!openaiService?.hasApiKey()) return null;
    return await openaiService.generateNotes(data.transcript, data.meetingTitle, data.existingNotes);
  });
  
  ipcMain.handle('openai-should-generate', (_, transcript: string[]) => {
    return openaiService?.shouldGenerateNotes(transcript) ?? false;
  });
  
  ipcMain.handle('openai-reset-session', () => {
    openaiService?.resetSession();
    return true;
  });
  
  ipcMain.handle('openai-generate-final', async (_, data: { transcript: string[], meetingTitle: string, userNotes: string }) => {
    if (!openaiService?.hasApiKey()) return null;
    // Get language settings
    const langSettings = store.get('langSettings', { transcriptionLang: 'en', aiNotesLang: 'same', autoDetect: false });
    return await openaiService.generateFinalSummary(
      data.transcript, 
      data.meetingTitle, 
      data.userNotes,
      langSettings.aiNotesLang,
      langSettings.transcriptionLang
    );
  });
  
  // Enhanced notes (generated AFTER meeting ends)
  // Uses AI router to choose between OpenAI and local LLM
  ipcMain.handle('openai-generate-enhanced', async (_, data: { transcript: string, rawNotes: string, meetingTitle: string, meetingInfo?: any, templateId?: string }) => {
    const aiEngine = getAIEngine();
    const localLLMReady = isLocalLLMReady();
    const hasOpenAIKey = openaiService?.hasApiKey() ?? false;
    
    console.log(`[IPC] 🤖 AI ENGINE STATUS:`);
    console.log(`[IPC]   - Selected engine: ${aiEngine.toUpperCase()}`);
    console.log(`[IPC]   - Local LLM ready: ${localLLMReady}`);
    console.log(`[IPC]   - OpenAI key configured: ${hasOpenAIKey}`);
    
    // Check if we can generate notes
    if (aiEngine === 'openai' && !hasOpenAIKey) {
      console.log('[IPC] No OpenAI API key, checking local LLM...');
      if (!localLLMReady) {
        console.log('[IPC] ❌ No AI engine available');
        return null;
      }
    } else if (aiEngine === 'local' && !localLLMReady) {
      console.log('[IPC] Local LLM not ready, falling back to OpenAI...');
      if (!hasOpenAIKey) {
        console.log('[IPC] ❌ No AI engine available');
        return null;
      }
    }
    
    console.log(`[IPC] ✅ Generating enhanced notes with engine: ${aiEngine.toUpperCase()}`);
    
    // Get language settings
    const langSettings = store.get('langSettings', { transcriptionLang: 'en', aiNotesLang: 'same', autoDetect: false }) as any;
    const outputLanguage = langSettings.aiNotesLang === 'same' ? langSettings.transcriptionLang : langSettings.aiNotesLang;
    console.log('[IPC] Output language:', outputLanguage);
    
    // Get template if specified
    let template = null;
    if (data.templateId) {
      const { getTemplateService } = require('./templates');
      template = getTemplateService().getTemplate(data.templateId);
      console.log('[IPC] Using template:', template?.name);
    } else {
      // Use default template
      const { getTemplateService } = require('./templates');
      template = getTemplateService().getDefaultTemplate();
      console.log('[IPC] Using default template:', template?.name);
    }
    
    // Use AI router which will choose between OpenAI and local LLM
    return await generateEnhancedNotesWithRouter(
      openaiService!,
      data.transcript, 
      data.rawNotes, 
      data.meetingTitle, 
      data.meetingInfo, 
      outputLanguage, 
      template
    );
  });
  
  // AI Q&A - Ask questions about meeting
  // Uses AI router to choose between OpenAI and local LLM
  ipcMain.handle('openai-ask-question', async (_, data: { question: string, transcript: string, notes: string, meetingTitle: string }) => {
    const aiEngine = getAIEngine();
    const hasOpenAI = openaiService?.hasApiKey();
    const hasLocalLLM = isLocalLLMReady();
    
    if (!hasOpenAI && !hasLocalLLM) {
      return { answer: null, error: 'No AI engine configured. Set up OpenAI API key or download local LLM.' };
    }
    
    console.log('[IPC] AI Q&A using engine:', aiEngine, '- Question:', data.question.substring(0, 50) + '...');
    
    try {
      const answer = await askQuestionWithRouter(
        openaiService!,
        data.question, 
        data.transcript, 
        data.notes, 
        data.meetingTitle
      );
      return { answer };
    } catch (err: any) {
      console.error('[IPC] AI Q&A Error:', err);
      return { answer: null, error: err.message };
    }
  });
  
  // AI Folder Suggestion - Suggest a folder based on note content
  // Uses AI router to choose between OpenAI and local LLM
  ipcMain.handle('openai-suggest-folder', async (_, data: { noteContent: string, meetingTitle: string }) => {
    const hasOpenAI = openaiService?.hasApiKey();
    const hasLocalLLM = isLocalLLMReady();
    
    if (!hasOpenAI && !hasLocalLLM) {
      console.log('[IPC] No AI available for folder suggestion');
      return null;
    }
    
    console.log('[IPC] Suggesting folder for:', data.meetingTitle, '- OpenAI:', hasOpenAI, 'LocalLLM:', hasLocalLLM);
    
    try {
      // Get all folders from database
      const allFolders = databaseService.getAllFolders();
      const folders = allFolders.map(f => ({
        id: f.id,
        name: f.name,
        description: f.description || ''
      }));
      
      console.log('[IPC] Available folders for suggestion:', folders.map(f => f.name));
      if (folders.length === 0) return null;
      
      const suggestion = await suggestFolderWithRouter(
        openaiService!,
        data.noteContent,
        data.meetingTitle,
        folders
      );
      
      return suggestion;
    } catch (err: any) {
      console.error('[IPC] Folder suggestion error:', err);
      return null;
    }
  });
  
  // AI Template Suggestion
  // Uses AI router to choose between OpenAI and local LLM
  ipcMain.handle('openai-suggest-template', async (_, data: { rawNotes: string, transcript: string, meetingTitle: string }) => {
    const hasOpenAI = openaiService?.hasApiKey();
    const hasLocalLLM = isLocalLLMReady();
    
    if (!hasOpenAI && !hasLocalLLM) return null;
    
    console.log('[IPC] Suggesting template for:', data.meetingTitle);
    
    try {
      const { getTemplateService } = require('./templates');
      const templateService = getTemplateService();
      const templates = templateService.getTemplates().map((t: any) => ({
        id: t.id,
        name: t.name,
        description: t.description || ''
      }));
      
      if (templates.length === 0) return null;
      
      const suggestion = await suggestTemplateWithRouter(
        openaiService!,
        data.meetingTitle,
        data.rawNotes,
        data.transcript,
        templates
      );
      
      return suggestion;
    } catch (err: any) {
      console.error('[IPC] Template suggestion error:', err);
      return null;
    }
  });
  
  // ============================================================================
  // PARAKEET (RUST) - Native module transcription
  // ============================================================================
  
  ipcMain.handle('parakeet-check-downloaded', async () => {
    try {
      return nativeModule?.isParakeetDownloaded?.() ?? false;
    } catch (e) {
      console.error('[Parakeet] Check downloaded error:', e);
      return false;
    }
  });

  ipcMain.handle('parakeet-get-info', async () => {
    try {
      return nativeModule?.getParakeetModelInfo?.() ?? {
        downloaded: false,
        version: 'v3',
        size: 0,
        path: ''
      };
    } catch (e) {
      console.error('[Parakeet] Get info error:', e);
      return { downloaded: false, version: 'v3', size: 0, path: '' };
    }
  });

  ipcMain.handle('parakeet-check-requirements', async () => {
    // Rust handles this - just check if native module is available
    return {
      hasOnnxRuntime: !!nativeModule,
      hasGpuSupport: true, // ONNX Runtime handles GPU automatically
      availableMemory: 4000000000,
      meetsRequirements: !!nativeModule,
      missingRequirements: nativeModule ? [] : ['Native module not loaded']
    };
  });

  ipcMain.handle('parakeet-download-model', async () => {
    console.log('[Parakeet] Starting download via Rust (background thread)...');
    
    try {
      // This now spawns a background thread and returns immediately
      const started = nativeModule?.downloadParakeetModel?.();
      console.log('[Parakeet] Download started:', started);
      return { success: true, started: !!started };
    } catch (error: any) {
      console.error('[Parakeet] Download start error:', error);
      return { success: false, started: false, error: error.message || String(error) };
    }
  });

  ipcMain.handle('parakeet-cancel-download', async () => {
    // HuggingFace downloads are atomic - can't cancel mid-download
    return true;
  });

  ipcMain.handle('parakeet-test-model', async () => {
    try {
      // Try to initialize the model - if it works, the model is valid
      return nativeModule?.initParakeet?.() ?? false;
    } catch (e) {
      console.error('[Parakeet] Test model error:', e);
      return false;
    }
  });

  ipcMain.handle('parakeet-delete-model', async () => {
    try {
      nativeModule?.shutdownParakeet?.();
      const result = nativeModule?.deleteParakeetModel?.() ?? false;
      
      // Notify editor window that model was deleted
      if (result && editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send('model-deleted', 'parakeet');
      }
      
      return result;
    } catch (e) {
      console.error('[Parakeet] Delete model error:', e);
      return false;
    }
  });

  // Show confirm dialog with app icon
  ipcMain.handle('show-confirm-dialog', async (_, options: { title: string; message: string; okLabel?: string; cancelLabel?: string }) => {
    const iconPath = path.join(__dirname, '../renderer/assets/logo.png');
    const result = await dialog.showMessageBox({
      type: 'question',
      buttons: [options.cancelLabel || 'Cancel', options.okLabel || 'OK'],
      defaultId: 1,
      cancelId: 0,
      title: options.title,
      message: options.message,
      icon: nativeImage.createFromPath(iconPath),
    });
    return result.response === 1; // true if OK was clicked
  });
  
  // Show alert dialog with app icon
  ipcMain.handle('show-alert-dialog', async (_, options: { title: string; message: string; type?: 'info' | 'warning' | 'error' }) => {
    const iconPath = path.join(__dirname, '../renderer/assets/logo.png');
    await dialog.showMessageBox({
      type: options.type || 'info',
      buttons: ['OK'],
      title: options.title,
      message: options.message,
      icon: nativeImage.createFromPath(iconPath),
    });
    return true;
  });

  // Get download progress (polled by UI)
  ipcMain.handle('parakeet-get-download-progress', async () => {
    try {
      return nativeModule?.getParakeetDownloadProgress?.() ?? {
        isDownloading: false,
        currentFile: '',
        currentFileIndex: 0,
        totalFiles: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        error: null
      };
    } catch (e) {
      console.error('[Parakeet] Get progress error:', e);
      return {
        isDownloading: false,
        currentFile: '',
        currentFileIndex: 0,
        totalFiles: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        error: String(e)
      };
    }
  });

  ipcMain.handle('parakeet-get-languages', async () => {
    try {
      const codes = nativeModule?.getParakeetLanguages?.() ?? [];
      const names = ['English', 'German', 'Spanish', 'French', 'Italian', 'Portuguese', 'Dutch', 'Polish', 'Russian', 'Ukrainian', 'Czech', 'Slovak', 'Hungarian', 'Romanian', 'Bulgarian', 'Croatian', 'Slovenian', 'Serbian', 'Danish', 'Finnish', 'Norwegian', 'Swedish', 'Greek', 'Turkish', 'Vietnamese'];
      return { codes, names };
    } catch (e) {
      return { codes: [], names: [] };
    }
  });

  // Transcription Engine Selection
  ipcMain.handle('transcription-get-engine', async () => {
    return transcriptionRouter.getEngine();
  });

  ipcMain.handle('transcription-set-engine', async (_, engine: 'deepgram' | 'parakeet') => {
    transcriptionRouter.setEngine(engine);
    
    // Notify editor window that engine changed
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('engine-changed');
      editorWindow.webContents.send('config-status-changed');
    }
    
    return true;
  });

  ipcMain.handle('transcription-is-parakeet-ready', async () => {
    try {
      return nativeModule?.isParakeetReady?.() ?? false;
    } catch (e) {
      return false;
    }
  });

  // Initialize Parakeet
  ipcMain.handle('parakeet-init', async () => {
    try {
      return nativeModule?.initParakeet?.() ?? false;
    } catch (e) {
      console.error('[Parakeet] Init error:', e);
      return false;
    }
  });

  // Transcribe audio file using Parakeet
  ipcMain.handle('parakeet-transcribe-file', async (_, audioPath: string) => {
    try {
      return nativeModule?.transcribeAudioFile?.(audioPath) ?? '';
    } catch (e: any) {
      console.error('[Parakeet] Transcribe file error:', e);
      throw new Error(e.message || String(e));
    }
  });

  // Transcribe audio buffer using Parakeet
  ipcMain.handle('parakeet-transcribe-buffer', async (_, audioData: Buffer, sampleRate?: number, channels?: number) => {
    try {
      return nativeModule?.transcribeAudioBuffer?.(audioData, sampleRate, channels) ?? '';
    } catch (e: any) {
      console.error('[Parakeet] Transcribe buffer error:', e);
      throw new Error(e.message || String(e));
    }
  });

  // ============================================================================
  // LOCAL LLM (Llama 3.2 via mistral.rs)
  // ============================================================================

  // Get LLM model info
  ipcMain.handle('llm-get-info', async () => {
    try {
      return nativeModule?.getLlmModelInfo?.() ?? {
        ready: false,
        modelName: 'Llama 3.2 3B Instruct',
        modelRepo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
        modelFile: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
        estimatedSize: 2019000000
      };
    } catch (e) {
      console.error('[LLM] Get info error:', e);
      return { ready: false, modelName: 'Unknown', modelRepo: '', modelFile: '', estimatedSize: 0 };
    }
  });

  // Check if LLM is ready
  ipcMain.handle('llm-is-ready', async () => {
    try {
      return nativeModule?.isLlmReady?.() ?? false;
    } catch (e) {
      return false;
    }
  });

  // Check if LLM model is downloaded (but not necessarily loaded)
  ipcMain.handle('llm-is-downloaded', async () => {
    try {
      return nativeModule?.isLlmDownloaded?.() ?? false;
    } catch (e) {
      return false;
    }
  });

  // Initialize LLM (async - starts download/load in background)
  ipcMain.handle('llm-init', async () => {
    console.log('[LLM] Starting initialization...');
    try {
      return nativeModule?.initLlm?.() ?? false;
    } catch (e) {
      console.error('[LLM] Init error:', e);
      return false;
    }
  });

  // Initialize LLM (sync - blocks until ready)
  ipcMain.handle('llm-init-sync', async () => {
    console.log('[LLM] Starting sync initialization...');
    try {
      return nativeModule?.initLlmSync?.() ?? false;
    } catch (e: any) {
      console.error('[LLM] Sync init error:', e);
      throw new Error(e.message || String(e));
    }
  });

  // Get initialization progress
  ipcMain.handle('llm-get-init-progress', async () => {
    try {
      return nativeModule?.getLlmInitProgress?.() ?? {
        isLoading: false,
        status: '',
        error: null
      };
    } catch (e) {
      return { isLoading: false, status: '', error: String(e) };
    }
  });

  // Chat completion (non-streaming)
  ipcMain.handle('llm-chat', async (_, messagesJson: string, maxTokens?: number, temperature?: number) => {
    console.log('[LLM] Chat request received');
    try {
      const result = nativeModule?.llmChat?.(messagesJson, maxTokens, temperature);
      console.log('[LLM] Chat response:', result?.text?.substring(0, 50) + '...');
      return result;
    } catch (e: any) {
      console.error('[LLM] Chat error:', e);
      throw new Error(e.message || String(e));
    }
  });

  // Simple text generation
  ipcMain.handle('llm-generate', async (_, prompt: string, maxTokens?: number, temperature?: number) => {
    console.log('[LLM] Generate request received');
    try {
      return nativeModule?.llmGenerate?.(prompt, maxTokens, temperature);
    } catch (e: any) {
      console.error('[LLM] Generate error:', e);
      throw new Error(e.message || String(e));
    }
  });

  // Shutdown LLM
  ipcMain.handle('llm-shutdown', async () => {
    try {
      nativeModule?.shutdownLlm?.();
      return true;
    } catch (e) {
      console.error('[LLM] Shutdown error:', e);
      return false;
    }
  });
  
  ipcMain.handle('llm-delete-model', async () => {
    console.log('[LLM] Delete model IPC called');
    try {
      console.log('[LLM] Calling nativeModule.deleteLlmModel...');
      const result = nativeModule?.deleteLlmModel?.();
      console.log('[LLM] Delete result:', result);
      
      // Notify editor window that model was deleted
      if (result && editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send('model-deleted', 'llm');
      }
      
      return result ?? false;
    } catch (e) {
      console.error('[LLM] Delete model error:', e);
      return false;
    }
  });

  // Get/Set AI engine preference (openai or local)
  ipcMain.handle('ai-get-engine', async () => {
    const engine = store.get('aiEngine', 'openai') as string;
    console.log('[IPC] ai-get-engine returning:', engine);
    return engine;
  });

  ipcMain.handle('ai-set-engine', async (_, engine: 'openai' | 'local') => {
    store.set('aiEngine', engine);
    console.log('[AI] Engine set to:', engine);
    
    // Auto-initialize local LLM when selected
    if (engine === 'local') {
      const isReady = nativeModule?.isLlmReady?.() ?? false;
      console.log('[AI] Local LLM ready:', isReady);
      
      if (!isReady) {
        console.log('[AI] Auto-initializing local LLM...');
        try {
          nativeModule?.initLlm?.();
        } catch (e) {
          console.error('[AI] Failed to init LLM:', e);
        }
      }
    }
    
    // Notify editor window that engine changed
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('engine-changed');
      // Also send updated config status
      editorWindow.webContents.send('config-status-changed');
    }
    
    return true;
  });

  // ============================================================================
  // CONFIGURATION STATUS (for banner warnings)
  // ============================================================================
  
  ipcMain.handle('get-config-status', async () => {
    const aiEngine = store.get('aiEngine', 'openai') as string;
    const transcriptionEngine = transcriptionRouter?.getEngine() ?? 'deepgram';
    
    const hasOpenAIKey = openaiService?.hasApiKey() ?? false;
    const hasDeepgramKey = transcriptionService?.hasApiKey() ?? false;
    const isLocalLLMReady = nativeModule?.isLlmReady?.() ?? false;
    const isLocalLLMDownloaded = nativeModule?.isLlmDownloaded?.() ?? false;
    const isParakeetReady = nativeModule?.isParakeetReady?.() ?? false;
    const isParakeetDownloaded = nativeModule?.isParakeetDownloaded?.() ?? false;
    
    const issues: Array<{
      type: 'error' | 'warning';
      category: 'ai' | 'transcription';
      message: string;
      action: string;
      actionType: 'add-key' | 'use-local' | 'download-model' | 'open-settings';
    }> = [];
    
    // Check AI engine configuration
    if (aiEngine === 'openai' && !hasOpenAIKey) {
      issues.push({
        type: 'warning',
        category: 'ai',
        message: 'OpenAI API key not configured. AI notes generation will not work.',
        action: 'Add OpenAI Key',
        actionType: 'add-key'
      });
    } else if (aiEngine === 'local' && !isLocalLLMDownloaded) {
      issues.push({
        type: 'warning',
        category: 'ai',
        message: 'Local AI model (Qwen) not downloaded. AI notes generation will not work.',
        action: 'Download Model',
        actionType: 'download-model'
      });
    } else if (aiEngine === 'local' && isLocalLLMDownloaded && !isLocalLLMReady) {
      issues.push({
        type: 'warning',
        category: 'ai',
        message: 'Local AI model is loading...',
        action: 'Please wait',
        actionType: 'open-settings'
      });
    }
    
    // Check transcription engine configuration
    if (transcriptionEngine === 'deepgram' && !hasDeepgramKey) {
      issues.push({
        type: 'warning',
        category: 'transcription',
        message: 'Deepgram API key not configured. Transcription will not work.',
        action: 'Add Deepgram Key',
        actionType: 'add-key'
      });
    } else if (transcriptionEngine === 'parakeet' && !isParakeetDownloaded) {
      issues.push({
        type: 'warning',
        category: 'transcription',
        message: 'Local transcription model (Parakeet) not downloaded.',
        action: 'Download Model',
        actionType: 'download-model'
      });
    }
    
    const status = {
      aiEngine,
      transcriptionEngine,
      aiReady: aiEngine === 'openai' ? hasOpenAIKey : (isLocalLLMReady || isLocalLLMDownloaded),
      transcriptionReady: transcriptionEngine === 'deepgram' ? hasDeepgramKey : isParakeetDownloaded,
      hasOpenAIKey,
      hasDeepgramKey,
      isLocalLLMReady,
      isLocalLLMDownloaded,
      isParakeetReady,
      isParakeetDownloaded,
      issues,
      hasIssues: issues.length > 0
    };
    
    console.log('[ConfigStatus]', JSON.stringify(status, null, 2));
    return status;
  });

  // ============================================================================
  // EMBEDDING (Local MiniLM model for offline vector search)
  // ============================================================================
  
  ipcMain.handle('embedding-check-downloaded', async () => {
    try {
      return nativeModule?.isEmbeddingDownloaded?.() ?? false;
    } catch (e) {
      console.error('[Embedding] Check downloaded error:', e);
      return false;
    }
  });

  ipcMain.handle('embedding-download-model', async () => {
    console.log('[Embedding] Starting download...');
    try {
      return nativeModule?.downloadEmbeddingModel?.() ?? false;
    } catch (e) {
      console.error('[Embedding] Download error:', e);
      return false;
    }
  });

  ipcMain.handle('embedding-get-download-progress', async () => {
    try {
      return nativeModule?.getEmbeddingDownloadProgress?.() ?? {
        isDownloading: false,
        currentFile: '',
        currentFileIndex: 0,
        totalFiles: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        error: null
      };
    } catch (e) {
      return {
        isDownloading: false,
        currentFile: '',
        currentFileIndex: 0,
        totalFiles: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
        percent: 0,
        error: String(e)
      };
    }
  });

  ipcMain.handle('embedding-init', async () => {
    console.log('[Embedding] Initializing model...');
    try {
      return nativeModule?.initEmbeddingModel?.() ?? false;
    } catch (e) {
      console.error('[Embedding] Init error:', e);
      return false;
    }
  });

  ipcMain.handle('embedding-is-ready', async () => {
    try {
      return nativeModule?.isEmbeddingReady?.() ?? false;
    } catch (e) {
      return false;
    }
  });

  ipcMain.handle('embedding-generate', async (_, text: string) => {
    try {
      return nativeModule?.generateEmbedding?.(text) ?? null;
    } catch (e) {
      console.error('[Embedding] Generate error:', e);
      return null;
    }
  });

  ipcMain.handle('embedding-generate-batch', async (_, texts: string[]) => {
    try {
      return nativeModule?.generateEmbeddingsBatch?.(texts) ?? null;
    } catch (e) {
      console.error('[Embedding] Batch generate error:', e);
      return null;
    }
  });

  ipcMain.handle('embedding-delete-model', async () => {
    console.log('[Embedding] Delete model called');
    try {
      const result = nativeModule?.deleteEmbeddingModel?.();
      if (result && editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send('model-deleted', 'embedding');
      }
      return result ?? false;
    } catch (e) {
      console.error('[Embedding] Delete error:', e);
      return false;
    }
  });

  ipcMain.handle('embedding-get-dimension', async () => {
    try {
      return nativeModule?.getEmbeddingDimension?.() ?? 384;
    } catch (e) {
      return 384;
    }
  });

  // Get/Set embedding engine preference (openai or local)
  ipcMain.handle('embedding-get-engine', async () => {
    return store.get('embeddingEngine', 'local') as string; // Default to local
  });

  ipcMain.handle('embedding-set-engine', async (_, engine: 'openai' | 'local') => {
    const previousEngine = store.get('embeddingEngine', 'local') as string;
    store.set('embeddingEngine', engine);
    console.log('[Embedding] Engine set to:', engine);
    
    // Auto-initialize local embedding when selected
    if (engine === 'local') {
      const isDownloaded = nativeModule?.isEmbeddingDownloaded?.() ?? false;
      const isReady = nativeModule?.isEmbeddingReady?.() ?? false;
      
      if (isDownloaded && !isReady) {
        console.log('[Embedding] Auto-initializing local embedding model...');
        try {
          nativeModule?.initEmbeddingModel?.();
        } catch (e) {
          console.error('[Embedding] Failed to init:', e);
        }
      }
    }
    
    // Return whether reindex is needed (engine changed)
    return { success: true, needsReindex: previousEngine !== engine };
  });
}

// ============================================================================
// APP LIFECYCLE
// ============================================================================
app.whenReady().then(async () => {
  console.log('[Ghost] Starting...');
  
  // Show app in Dock (macOS) with custom icon
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
    // Set dock icon to our logo PNG
    const pngPath = path.join(__dirname, '..', 'renderer', 'assets', 'logo.png');
    console.log('[App] Setting dock icon from:', pngPath, 'exists:', fs.existsSync(pngPath));
    if (fs.existsSync(pngPath)) {
      const dockIcon = nativeImage.createFromPath(pngPath);
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon);
        console.log('[App] ✅ Dock icon set successfully, size:', dockIcon.getSize());
      } else {
        console.log('[App] ❌ Dock icon was empty');
      }
    }
  }
  
  // 1. Create anchor window FIRST (keeps app stable)
  createAnchorWindow();
  
  // 2. Setup IPC
  setupIPC();
  
  // 3. Initialize services
  transcriptionService = transcriptionRouter.getDeepgramService(); // For backward compatibility
  calendarService = new CalendarService(store);
  openaiService = new OpenAIService();
  
  // Apply saved language settings to transcription router
  const savedLangSettings = store.get('langSettings', { transcriptionLang: 'en', aiNotesLang: 'same', autoDetect: false }) as any;
  if (transcriptionRouter) {
    transcriptionRouter.setLanguage(savedLangSettings.transcriptionLang, savedLangSettings.autoDetect);
    console.log('[App] Applied saved language settings:', savedLangSettings);
  }
  
  // Auto-initialize local LLM if selected
  const aiEngine = store.get('aiEngine', 'openai') as string;
  if (aiEngine === 'local') {
    const isReady = nativeModule?.isLlmReady?.() ?? false;
    console.log('[App] AI Engine set to LOCAL, checking if ready:', isReady);
    
    if (!isReady) {
      console.log('[App] Auto-initializing local LLM in background...');
      try {
        nativeModule?.initLlm?.();
      } catch (e) {
        console.error('[App] Failed to init LLM:', e);
      }
    }
  }
  
  // 4. Initialize database (required - no fallback)
  console.log('[Database] Initializing SQLite database...');
  const dbInitialized = await databaseService.initialize();
  if (!dbInitialized) {
    console.error('[Database] ❌ Failed to initialize SQLite database!');
    throw new Error('Database initialization failed. Cannot start app without database.');
  }
  console.log('[Database] ✅ SQLite database ready');
  
  // Run migration if not done yet
  if (!fs.existsSync(MIGRATION_DONE_FLAG)) {
    console.log('[Database] Running migration from JSON files...');
    const stats = await databaseService.migrateFromJSON();
    console.log('[Database] ✅ Migration complete:', stats);
    fs.writeFileSync(MIGRATION_DONE_FLAG, new Date().toISOString());
  }
  
  // Start calendar reminder service if connected
  if (calendarService.isConnected()) {
    calendarService.startReminderService(showMeetingReminder);
  }
  
  // Handle sleep/wake to prevent crashes
  powerMonitor.on('suspend', () => {
    console.log('[IceCubes] System suspending - pausing services...');
    // Stop active recording/transcription gracefully
    if (isRecording) {
      console.log('[IceCubes] Stopping recording due to system sleep');
      // Tell editor to stop transcription
      if (editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.webContents.send('recording-stopped');
      }
      isRecording = false;
      stopAutoSaveInterval();
    }
    // Stop meeting watcher
    meetingWatcher?.stop();
  });
  
  powerMonitor.on('resume', () => {
    console.log('[IceCubes] System resuming - restarting services...');
    // Restart meeting watcher after brief delay
    setTimeout(() => {
      if (meetingWatcher) {
        console.log('[IceCubes] Restarting meeting watcher...');
        meetingWatcher.start(
          (meeting) => {
            console.log('[Meeting] Detected:', meeting.provider);
            currentMeeting = meeting;
            updateTrayMenu();
            
            const notifSettings = store.get('notifSettings', {
              scheduledMeetings: true,
              autoDetectedMeetings: true,
              mutedApps: []
            });
            
            const appName = meeting.isBrowser ? 'Chrome' : meeting.provider;
            const isMuted = notifSettings.mutedApps?.some((app: string) => 
              meeting.title?.toLowerCase().includes(app.toLowerCase()) ||
              meeting.provider?.toLowerCase().includes(app.toLowerCase())
            );
            
            if (meeting.pid !== lastNotifiedMeetingPid && !isRecording && notifSettings.autoDetectedMeetings && !isMuted) {
              lastNotifiedMeetingPid = meeting.pid;
              showMeetingBar(meeting);
            }
          },
          () => {
            console.log('[Meeting] Ended');
            currentMeeting = null;
            updateTrayMenu();
            closeMeetingBar();
          }
        );
      }
    }, 2000); // Wait 2 seconds for system to fully resume
  });
  
  // 4. Create tray - this is the main UI
  createTray();
  
  // 4.5 Show the main editor window on startup (so app is visible, not hidden)
  openEditorWindow(true); // true = show home view
  
  // 5. Check permissions
  const perms = await checkPermissions();
  if (!perms.microphone || !perms.screenRecording || !perms.accessibility) {
    console.log('[Ghost] Missing permissions, requesting...');
    await requestPermissions();
  }
  
  // 6. Initialize native module and meeting watcher
  const native = getNativeModule();
  if (native) {
    meetingWatcher = new MeetingWatcher(native);
    audioEngine = new AudioEngine(native);
    
    // Wait 5 seconds after app is fully loaded before starting meeting detection
    console.log('[Ghost] Waiting 5 seconds before starting meeting detection...');
    setTimeout(() => {
      console.log('[Ghost] Starting meeting watcher...');
      meetingWatcher?.start(
      (meeting) => {
        console.log('[Meeting] Detected:', meeting.provider);
        currentMeeting = meeting;
        updateTrayMenu();
        
        // Check notification settings for auto-detected meetings
        const notifSettings = store.get('notifSettings', {
          scheduledMeetings: true,
          autoDetectedMeetings: true,
          mutedApps: []
        });
        
        // Check if this app is muted
        const appName = meeting.isBrowser ? 'Chrome' : meeting.provider; // Simplified - could be improved
        const isMuted = notifSettings.mutedApps?.some((app: string) => 
          meeting.title?.toLowerCase().includes(app.toLowerCase()) ||
          meeting.provider?.toLowerCase().includes(app.toLowerCase())
        );
        
        // Only show bar for NEW meetings (different PID) and if notifications are enabled
        if (meeting.pid !== lastNotifiedMeetingPid && !isRecording && notifSettings.autoDetectedMeetings && !isMuted) {
          lastNotifiedMeetingPid = meeting.pid;
          showMeetingBar(meeting);
        }
      },
      () => {
        console.log('[Meeting] Ended');
        console.log('[Meeting] Ended');
        if (isRecording) {
          stopRecording();
        }
        currentMeeting = null;
        lastNotifiedMeetingPid = null; // Reset so next meeting will show bar
        updateTrayMenu();
      }
      );
    }, 5000); // 5 second delay
  }
  
  console.log('[Ghost] ✅ Ready - will start watching for meetings in 5 seconds');
});

app.on('window-all-closed', () => {
  // Don't quit - we're a menu bar app
});

app.on('before-quit', (event) => {
  // If not force quitting, hide to tray instead
  if (!forceQuit) {
    event.preventDefault();
    // Hide all windows
    editorWindow?.hide();
    meetingBarWindow?.hide();
    // Hide from dock
    app.dock?.hide();
    console.log('[App] Hiding to tray instead of quitting');
    return;
  }
  
  // Actually quitting - clean up
  console.log('[App] Force quitting...');
  meetingWatcher?.stop();
  if (isRecording) {
    audioEngine?.stopRecording();
  }
  
  // Close database and save any pending changes
  console.log('[Database] Saving and closing database...');
  databaseService.close();
});

// Handle dock icon click on macOS - open editor window
app.on('activate', () => {
  console.log('[App] Dock icon clicked (activate event)');
  // If recording, show editor view with current note. Otherwise show home.
  openEditorWindow(!isRecording);
});
