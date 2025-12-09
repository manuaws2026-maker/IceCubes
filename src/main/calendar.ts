import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { BrowserWindow, safeStorage, shell } from 'electron';
import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';

// ============================================================================
// PKCE OAuth Flow for Desktop Apps
// ============================================================================

// Google Cloud OAuth credentials - set via environment variables or replace with your own
// To get your own credentials:
// 1. Go to https://console.cloud.google.com/apis/credentials
// 2. Create OAuth 2.0 Client ID (Desktop app type)
// 3. Enable Google Calendar API
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const TOKEN_PATH = path.join(app.getPath('userData'), 'calendar-token.json');
const REDIRECT_URI = 'http://localhost:8085/oauth2callback';

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  self?: boolean;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  organizer?: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  meetingLink?: string;
  location?: string;
  description?: string;
  isNow: boolean;
  isUpcoming: boolean;
  attendees?: CalendarAttendee[];
  organizer?: { email: string; displayName?: string };
}

// Generate PKCE code verifier (random string)
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// Generate PKCE code challenge (SHA256 hash of verifier, base64url encoded)
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export interface CalendarInfo {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
  selected: boolean;
}

export class CalendarService {
  private oauth2Client: OAuth2Client | null = null;
  private calendar: calendar_v3.Calendar | null = null;
  private isAuthenticated = false;
  private events: CalendarEvent[] = [];
  private refreshInterval: NodeJS.Timeout | null = null;
  private reminderCallbacks: ((event: CalendarEvent) => void)[] = [];
  private remindedEvents: Set<string> = new Set();
  private selectedCalendars: Set<string> = new Set(['primary']);
  private calendarList: CalendarInfo[] = [];
  private codeVerifier: string = '';
  private authServer: http.Server | null = null;

  constructor() {
    this.initializeClient();
    this.loadSelectedCalendars();
    this.loadExistingToken();
  }

  private initializeClient(): void {
    if (!CLIENT_ID) {
      console.log('[Calendar] No Client ID configured');
      return;
    }

    // Desktop apps need client secret for token refresh
    this.oauth2Client = new OAuth2Client({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
    });
  }

  private loadExistingToken(): boolean {
    console.log('[Calendar] loadExistingToken called, oauth2Client exists:', !!this.oauth2Client);
    if (!this.oauth2Client) {
      console.log('[Calendar] No oauth2Client, cannot load token');
      return false;
    }

    try {
      console.log('[Calendar] Checking if token file exists:', TOKEN_PATH);
      
      // Check for token file migration from old app names
      if (!fs.existsSync(TOKEN_PATH)) {
        const oldPaths = [
          path.join(app.getPath('userData').replace('icecubes', 'ghost-meeting-sdk'), 'calendar-token.json'),
          path.join(app.getPath('userData').replace('icecubes', 'coconotes'), 'calendar-token.json'),
        ];
        
        for (const oldPath of oldPaths) {
          if (fs.existsSync(oldPath)) {
            console.log('[Calendar] Found old token file at:', oldPath);
            console.log('[Calendar] Migrating to:', TOKEN_PATH);
            try {
              const tokenData = fs.readFileSync(oldPath, 'utf-8');
              // Ensure directory exists
              const dir = path.dirname(TOKEN_PATH);
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
              }
              fs.writeFileSync(TOKEN_PATH, tokenData);
              console.log('[Calendar] Token migrated successfully');
              break;
            } catch (e) {
              console.error('[Calendar] Failed to migrate token:', e);
            }
          }
        }
      }
      
      if (fs.existsSync(TOKEN_PATH)) {
        console.log('[Calendar] Token file exists, reading...');
        const tokenData = fs.readFileSync(TOKEN_PATH, 'utf-8');
        let token;
        
        // Try to decrypt if encrypted
        try {
          if (safeStorage.isEncryptionAvailable()) {
            console.log('[Calendar] Attempting to decrypt token...');
            const decrypted = safeStorage.decryptString(Buffer.from(tokenData, 'base64'));
            token = JSON.parse(decrypted);
            console.log('[Calendar] Token decrypted successfully');
          } else {
            console.log('[Calendar] Encryption not available, using plain token');
            token = JSON.parse(tokenData);
          }
        } catch (e) {
          console.log('[Calendar] Decryption failed, trying plain JSON. This is normal after migrating from old app name.');
          // Try parsing as plain JSON (token might be from old app with different encryption key)
          try {
            token = JSON.parse(tokenData);
            console.log('[Calendar] Successfully parsed as plain JSON');
            // Re-save with new encryption
            this.saveToken(token);
            console.log('[Calendar] Token re-encrypted with new app encryption');
          } catch (parseError) {
            console.error('[Calendar] Could not parse token as JSON:', parseError);
            throw parseError;
          }
        }
        
        console.log('[Calendar] Setting credentials...');
        this.oauth2Client.setCredentials(token);
        this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
        this.isAuthenticated = true;
        
        // Set up token refresh with detailed logging
        this.oauth2Client.on('tokens', (tokens) => {
          console.log('[Calendar] 🔄 TOKEN REFRESH EVENT TRIGGERED!');
          console.log('[Calendar] New tokens received:', {
            access_token: tokens.access_token ? tokens.access_token.substring(0, 20) + '...' : 'none',
            refresh_token: tokens.refresh_token ? 'present' : 'not included (using existing)',
            expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'none',
            token_type: tokens.token_type
          });
          
          // Merge with existing token (keep refresh_token if not provided)
          const existingToken = this.oauth2Client?.credentials;
          const mergedToken = {
            ...existingToken,
            ...tokens
          };
          this.saveToken(mergedToken);
          console.log('[Calendar] ✅ Token refreshed and saved successfully');
        });
        
        // Log token expiry info
        console.log('[Calendar] ✅ Loaded existing token, isAuthenticated set to true');
        console.log('[Calendar] Token expiry:', token.expiry_date ? new Date(token.expiry_date).toISOString() : 'unknown');
        console.log('[Calendar] Token expires in:', token.expiry_date ? Math.round((token.expiry_date - Date.now()) / 60000) + ' minutes' : 'unknown');
        return true;
      } else {
        console.log('[Calendar] Token file does not exist at:', TOKEN_PATH);
      }
    } catch (e) {
      console.log('[Calendar] Failed to load token:', e);
    }
    
    console.log('[Calendar] loadExistingToken returning false');
    return false;
  }

  private saveToken(token: any): void {
    try {
      const tokenStr = JSON.stringify(token);
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(tokenStr);
        fs.writeFileSync(TOKEN_PATH, encrypted.toString('base64'));
      } else {
        fs.writeFileSync(TOKEN_PATH, tokenStr);
      }
      console.log('[Calendar] Token saved securely');
    } catch (e) {
      console.error('[Calendar] Failed to save token:', e);
    }
  }

  /**
   * Force-expire the current token for testing refresh flow.
   * Sets expiry_date to 1 minute ago so next API call will trigger refresh.
   */
  forceExpireToken(): boolean {
    console.log('[Calendar] ⚠️ FORCE EXPIRING TOKEN FOR TESTING');
    
    if (!this.oauth2Client) {
      console.log('[Calendar] No oauth2Client - cannot expire token');
      return false;
    }
    
    const credentials = this.oauth2Client.credentials;
    if (!credentials || !credentials.access_token) {
      console.log('[Calendar] No credentials found - cannot expire token');
      return false;
    }
    
    // Set expiry to 1 minute ago
    const expiredToken = {
      ...credentials,
      expiry_date: Date.now() - 60000 // 1 minute ago
    };
    
    console.log('[Calendar] Original expiry:', credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : 'none');
    console.log('[Calendar] New (expired) expiry:', new Date(expiredToken.expiry_date).toISOString());
    
    // Update the oauth2Client credentials
    this.oauth2Client.setCredentials(expiredToken);
    
    // Also save to disk so it persists
    this.saveToken(expiredToken);
    
    console.log('[Calendar] ✅ Token force-expired! Next API call will trigger refresh.');
    return true;
  }
  
  /**
   * Get current token status for debugging
   */
  getTokenStatus(): { isExpired: boolean; expiresIn: number | null; hasRefreshToken: boolean } {
    const credentials = this.oauth2Client?.credentials;
    if (!credentials) {
      return { isExpired: true, expiresIn: null, hasRefreshToken: false };
    }
    
    const now = Date.now();
    const expiryDate = credentials.expiry_date as number;
    const expiresIn = expiryDate ? Math.round((expiryDate - now) / 1000) : null;
    
    return {
      isExpired: expiryDate ? expiryDate < now : true,
      expiresIn,
      hasRefreshToken: !!credentials.refresh_token
    };
  }

  async authenticate(): Promise<boolean> {
    console.log('[Calendar] ========================================');
    console.log('[Calendar] authenticate() called');
    console.log('[Calendar] oauth2Client exists:', !!this.oauth2Client);
    console.log('[Calendar] CLIENT_ID:', CLIENT_ID ? 'SET (' + CLIENT_ID.substring(0, 20) + '...)' : 'EMPTY');
    
    if (!this.oauth2Client) {
      console.log('[Calendar] OAuth client not initialized - need Client ID');
      return false;
    }
    
    console.log('[Calendar] Generating PKCE codes...');

    // Close any existing auth server
    if (this.authServer) {
      try {
        this.authServer.close();
        this.authServer = null;
      } catch (e) {
        console.log('[Calendar] Error closing existing server:', e);
      }
    }

    // Generate PKCE codes
    this.codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(this.codeVerifier);

    return new Promise((resolve) => {
      this.authServer = http.createServer(async (req, res) => {
        try {
          const queryUrl = new url.URL(req.url!, `http://localhost:8085`);
          const code = queryUrl.searchParams.get('code');
          const error = queryUrl.searchParams.get('error');
          
          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #fef2f2;">
                  <div style="text-align: center; color: #991b1b;">
                    <h1>❌ Connection Failed</h1>
                    <p>${error}</p>
                    <p>Please try again.</p>
                  </div>
                </body>
              </html>
            `);
            this.authServer?.close();
            this.authServer = null;
            resolve(false);
            return;
          }
          
          if (code) {
            try {
              // Exchange code for tokens using PKCE FIRST (manual request for better debugging)
              console.log('[Calendar] Exchanging code for tokens...');
              console.log('[Calendar] Code verifier:', this.codeVerifier);
              console.log('[Calendar] Redirect URI:', REDIRECT_URI);
              
              // Make manual token request for better error handling
              const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                  client_id: CLIENT_ID,
                  client_secret: CLIENT_SECRET,
                  code: code,
                  code_verifier: this.codeVerifier,
                  grant_type: 'authorization_code',
                  redirect_uri: REDIRECT_URI,
                }).toString(),
              });
              
              const tokenData: any = await tokenResponse.json();
              console.log('[Calendar] Token response status:', tokenResponse.status);
              console.log('[Calendar] Token response:', JSON.stringify(tokenData, null, 2));
              
              if (!tokenResponse.ok) {
                throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed');
              }
              
              const tokens = {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expiry_date: Date.now() + (tokenData.expires_in * 1000),
                token_type: tokenData.token_type,
                scope: tokenData.scope,
              };
              
              console.log('[Calendar] Token exchange successful');
              this.oauth2Client!.setCredentials(tokens);
              this.saveToken(tokens);
              
              // Set up token refresh listener
              this.oauth2Client!.on('tokens', (newTokens) => {
                this.saveToken({ ...tokens, ...newTokens });
              });

              this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client! });
              this.isAuthenticated = true;
              console.log('[Calendar] Successfully authenticated with PKCE');
              
              // NOW show success page
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <!DOCTYPE html>
                <html>
                  <head>
                    <meta charset="UTF-8">
                    <title>IceCubes - Connected</title>
                  </head>
                  <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);">
                    <div style="text-align: center; padding: 40px; background: white; border-radius: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); max-width: 400px;">
                      <svg width="64" height="64" viewBox="0 0 100 100" style="margin-bottom: 16px;">
                        <defs>
                          <linearGradient id="iceGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#60a5fa;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#3b82f6;stop-opacity:1" />
                          </linearGradient>
                        </defs>
                        <rect x="15" y="15" width="70" height="70" rx="12" fill="url(#iceGrad)" />
                        <rect x="25" y="25" width="20" height="20" rx="4" fill="rgba(255,255,255,0.4)" />
                        <rect x="55" y="25" width="20" height="20" rx="4" fill="rgba(255,255,255,0.25)" />
                        <rect x="25" y="55" width="20" height="20" rx="4" fill="rgba(255,255,255,0.25)" />
                        <rect x="55" y="55" width="20" height="20" rx="4" fill="rgba(255,255,255,0.15)" />
                      </svg>
                      <h1 style="color: #065f46; margin: 0 0 12px; font-size: 24px; font-weight: 600;">Connected to Google Calendar!</h1>
                      <p style="color: #6b7280; margin: 0; font-size: 15px;">You can close this window and return to IceCubes.</p>
                      <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                        <span style="color: #10b981; font-size: 14px; font-weight: 500;">✓ Calendar sync enabled</span>
                      </div>
                    </div>
                  </body>
                </html>
              `);
              
              this.authServer?.close();
              this.authServer = null;
              resolve(true);
            } catch (tokenError: any) {
              console.error('[Calendar] Token exchange error:', tokenError);
              res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <!DOCTYPE html>
                <html>
                  <head>
                    <meta charset="UTF-8">
                    <title>IceCubes - Error</title>
                  </head>
                  <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);">
                    <div style="text-align: center; padding: 40px; background: white; border-radius: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); max-width: 400px;">
                      <div style="font-size: 64px; margin-bottom: 16px;">😕</div>
                      <h1 style="color: #991b1b; margin: 0 0 12px; font-size: 24px; font-weight: 600;">Connection Failed</h1>
                      <p style="color: #6b7280; margin: 0 0 16px; font-size: 15px;">${tokenError.message || 'Unknown error'}</p>
                      <p style="color: #9ca3af; margin: 0; font-size: 14px;">Please close this window and try again in IceCubes.</p>
                    </div>
                  </body>
                </html>
              `);
              this.authServer?.close();
              this.authServer = null;
              resolve(false);
            }
          }
        } catch (e: any) {
          console.error('[Calendar] OAuth error:', e);
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="UTF-8">
                <title>IceCubes - Error</title>
              </head>
              <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);">
                <div style="text-align: center; padding: 40px; background: white; border-radius: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.1); max-width: 400px;">
                  <div style="font-size: 64px; margin-bottom: 16px;">😕</div>
                  <h1 style="color: #991b1b; margin: 0 0 12px; font-size: 24px; font-weight: 600;">Authentication Error</h1>
                  <p style="color: #6b7280; margin: 0 0 16px; font-size: 15px;">${e.message || 'Unknown error'}</p>
                  <p style="color: #9ca3af; margin: 0; font-size: 14px;">Please close this window and try again in IceCubes.</p>
                </div>
              </body>
            </html>
          `);
          this.authServer?.close();
          this.authServer = null;
          resolve(false);
        }
      });

      // Handle server errors (e.g., port already in use)
      this.authServer.on('error', (err: any) => {
        console.error('[Calendar] Server error:', err.message);
        if (err.code === 'EADDRINUSE') {
          console.log('[Calendar] Port 8085 already in use, trying to close existing...');
        }
        resolve(false);
      });
      
      this.authServer.listen(8085, () => {
        console.log('[Calendar] Local server listening on port 8085');
        
        // Generate auth URL with PKCE challenge
        const authUrl = this.oauth2Client!.generateAuthUrl({
          access_type: 'offline',
          scope: SCOPES,
          prompt: 'consent',
          code_challenge: codeChallenge,
          code_challenge_method: 'S256' as any,
        });
        
        console.log('[Calendar] Auth URL generated:', authUrl.substring(0, 100) + '...');
        console.log('[Calendar] Opening browser...');
        shell.openExternal(authUrl);
        console.log('[Calendar] Browser open command sent');
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (!this.isAuthenticated && this.authServer) {
          this.authServer.close();
          this.authServer = null;
          resolve(false);
        }
      }, 300000);
    });
  }

  async disconnect(): Promise<void> {
    if (fs.existsSync(TOKEN_PATH)) {
      fs.unlinkSync(TOKEN_PATH);
    }
    this.isAuthenticated = false;
    this.calendar = null;
    this.events = [];
    this.stopReminderService();
    console.log('[Calendar] Disconnected');
  }

  isConnected(): boolean {
    const connected = this.isAuthenticated && !!CLIENT_ID;
    console.log('[Calendar] isConnected check - isAuthenticated:', this.isAuthenticated, 'CLIENT_ID exists:', !!CLIENT_ID, 'returning:', connected);
    return connected;
  }

  hasClientId(): boolean {
    console.log('[Calendar] hasClientId check, CLIENT_ID:', CLIENT_ID ? 'SET' : 'EMPTY');
    return !!CLIENT_ID;
  }

  async fetchEvents(): Promise<CalendarEvent[]> {
    if (!this.calendar || !this.isAuthenticated) {
      console.log('[Calendar] fetchEvents: Not authenticated');
      return [];
    }

    try {
      // Log token status before API call
      const tokenStatus = this.getTokenStatus();
      console.log('[Calendar] fetchEvents: Token status before API call:', {
        isExpired: tokenStatus.isExpired,
        expiresIn: tokenStatus.expiresIn ? `${tokenStatus.expiresIn} seconds` : 'unknown',
        hasRefreshToken: tokenStatus.hasRefreshToken
      });
      
      if (tokenStatus.isExpired) {
        console.log('[Calendar] ⚠️ Token is EXPIRED - Google OAuth will attempt refresh...');
      }
      
      const now = new Date();
      
      // Fetch events for the next 7 days
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 7);

      console.log(`[Calendar] Fetching events from ${now.toISOString()} to ${endDate.toISOString()}`);

      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: endDate.toISOString(),
        maxResults: 50,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const items = response.data.items || [];
      console.log(`[Calendar] Fetched ${items.length} raw events`);
      
      this.events = items.map((event): CalendarEvent => {
        const start = event.start?.dateTime 
          ? new Date(event.start.dateTime) 
          : new Date(event.start?.date || now);
        const end = event.end?.dateTime 
          ? new Date(event.end.dateTime) 
          : new Date(event.end?.date || now);
        
        const isNow = now >= start && now <= end;
        const minutesUntil = (start.getTime() - now.getTime()) / 60000;
        const isUpcoming = minutesUntil > 0 && minutesUntil <= 60;

        // Extract meeting link from various sources
        let meetingLink = event.hangoutLink || undefined;
        if (!meetingLink && event.conferenceData?.entryPoints) {
          const videoEntry = event.conferenceData.entryPoints.find(
            ep => ep.entryPointType === 'video'
          );
          meetingLink = videoEntry?.uri || undefined;
        }
        if (!meetingLink && event.location) {
          if (event.location.startsWith('http')) {
            meetingLink = event.location;
          }
        }
        if (!meetingLink && event.description) {
          // Try to extract meeting URL from description
          const urlMatch = event.description.match(
            /https?:\/\/[^\s<>"]*(?:meet|zoom|teams|webex)[^\s<>"]*/i
          );
          if (urlMatch) {
            meetingLink = urlMatch[0];
          }
        }

        // Extract attendees
        const attendees: CalendarAttendee[] = (event.attendees || []).map(a => ({
          email: a.email || '',
          displayName: a.displayName || undefined,
          self: a.self || false,
          responseStatus: a.responseStatus as any,
          organizer: a.organizer || false,
        }));

        return {
          id: event.id || '',
          title: event.summary || 'Untitled Event',
          start,
          end,
          meetingLink,
          location: event.location || undefined,
          description: event.description || undefined,
          isNow,
          isUpcoming,
          attendees: attendees.length > 0 ? attendees : undefined,
          organizer: event.organizer ? {
            email: event.organizer.email || '',
            displayName: event.organizer.displayName || undefined,
          } : undefined,
        };
      });

      console.log(`[Calendar] Fetched ${this.events.length} events`);
      return this.events;
    } catch (e: any) {
      console.error('[Calendar] Error fetching events:', e?.message || e);
      
      // If token expired/invalid or no refresh token, clear token and mark as disconnected
      const errorMsg = String(e?.message || e);
      if (e?.code === 401 || e?.code === 403 || 
          errorMsg.includes('invalid_request') || 
          errorMsg.includes('invalid_grant') ||
          errorMsg.includes('Token has been expired') ||
          errorMsg.includes('No refresh token')) {
        console.log('[Calendar] Token invalid/expired/missing refresh, clearing and disconnecting...');
        this.isAuthenticated = false;
        this.calendar = null;
        // Delete old token file so user can reconnect
        try {
          if (fs.existsSync(TOKEN_PATH)) {
            fs.unlinkSync(TOKEN_PATH);
            console.log('[Calendar] Cleared invalid token');
          }
        } catch {}
      }
      
      return [];
    }
  }

  getEvents(): CalendarEvent[] {
    return this.events;
  }

  // Fetch list of calendars
  async fetchCalendarList(): Promise<CalendarInfo[]> {
    if (!this.calendar || !this.isAuthenticated) {
      return [];
    }

    try {
      const response = await this.calendar.calendarList.list();
      const items = response.data.items || [];
      
      this.calendarList = items.map((cal): CalendarInfo => ({
        id: cal.id || '',
        summary: cal.summaryOverride || cal.summary || 'Untitled Calendar',
        backgroundColor: cal.backgroundColor || undefined,
        primary: cal.primary || false,
        selected: this.selectedCalendars.has(cal.id || '') || (cal.primary === true && this.selectedCalendars.has('primary')),
      }));

      console.log(`[Calendar] Fetched ${this.calendarList.length} calendars`);
      return this.calendarList;
    } catch (e: any) {
      console.error('[Calendar] Error fetching calendar list:', e?.message || e);
      return [];
    }
  }

  getCalendarList(): CalendarInfo[] {
    return this.calendarList;
  }

  setCalendarSelected(calendarId: string, selected: boolean): void {
    if (selected) {
      this.selectedCalendars.add(calendarId);
    } else {
      this.selectedCalendars.delete(calendarId);
      
      // Also remove 'primary' if this is the primary calendar being deselected
      const primaryCal = this.calendarList.find(c => c.primary);
      if (primaryCal && primaryCal.id === calendarId) {
        this.selectedCalendars.delete('primary');
      }
    }
    // Save to storage
    this.saveSelectedCalendars();
    // Re-fetch events with new selection
    this.fetchEvents();
  }

  private saveSelectedCalendars(): void {
    try {
      const selectedPath = path.join(app.getPath('userData'), 'selected-calendars.json');
      fs.writeFileSync(selectedPath, JSON.stringify([...this.selectedCalendars]));
    } catch (e) {
      console.error('[Calendar] Error saving selected calendars:', e);
    }
  }

  private loadSelectedCalendars(): void {
    try {
      const selectedPath = path.join(app.getPath('userData'), 'selected-calendars.json');
      if (fs.existsSync(selectedPath)) {
        const data = JSON.parse(fs.readFileSync(selectedPath, 'utf-8'));
        this.selectedCalendars = new Set(data);
      }
    } catch (e) {
      console.error('[Calendar] Error loading selected calendars:', e);
    }
  }

  // Start checking for upcoming meetings and sending reminders
  startReminderService(callback: (event: CalendarEvent) => void): void {
    this.reminderCallbacks.push(callback);
    
    if (this.refreshInterval) return; // Already running

    // Check every minute
    this.refreshInterval = setInterval(async () => {
      if (!this.isAuthenticated) return;

      await this.fetchEvents();
      
      const now = new Date();
      
      for (const event of this.events) {
        const minutesUntil = (event.start.getTime() - now.getTime()) / 60000;
        
        // Remind 3 minutes before
        if (minutesUntil > 0 && minutesUntil <= 3 && !this.remindedEvents.has(event.id)) {
          this.remindedEvents.add(event.id);
          console.log(`[Calendar] Reminder: ${event.title} in ${Math.round(minutesUntil)} minutes`);
          
          for (const cb of this.reminderCallbacks) {
            cb(event);
          }
        }
      }

      // Clean up old reminded events (remove events that have passed)
      const eventIds = new Set(this.events.map(e => e.id));
      for (const id of this.remindedEvents) {
        if (!eventIds.has(id)) {
          this.remindedEvents.delete(id);
        }
      }
    }, 60000); // Every minute

    // Initial fetch
    this.fetchEvents();
    console.log('[Calendar] Reminder service started');
  }

  stopReminderService(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.reminderCallbacks = [];
    console.log('[Calendar] Reminder service stopped');
  }
}
