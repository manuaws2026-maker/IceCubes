export interface MeetingInfo {
  provider: 'zoom' | 'teams' | 'meet' | 'slack' | 'webex' | 'manual';
  title: string;
  pid: number;
  windowId?: number;
  isBrowser: boolean;
  browserName?: string;
  url?: string;
  detectedAt?: number;
}

export interface NativeModule {
  getActiveWindows(): Array<{
    pid: number;
    windowId: number;
    ownerName: string;
    title: string;
    bundleId?: string;
  }>;
  getBrowserUrl?(pid: number): string | null;
  checkAccessibilityPermission(): boolean;
  isMicrophoneInUse(): boolean;
  // Speaker detection (computer vision)
  startSpeakerDetection?(windowId: number): void;
  stopSpeakerDetection?(): void;
  getDetectedSpeaker?(): string | null;
  detectSpeakerFromWindow?(windowId: number): {
    name: string | null;
    confidence: number;
    timestamp: number;
  };
}

// Meeting detection patterns
const MEETING_PATTERNS = {
  zoom: {
    native: {
      process: ['zoom.us', 'Zoom'],
      bundleId: 'us.zoom.xos',
      windowTitles: [/Zoom Meeting/i, /Zoom Webinar/i],
      excludeTitles: [/Zoom$/i, /Settings/i, /^Zoom Cloud Meetings$/i],
    },
  },
  teams: {
    native: {
      process: ['Microsoft Teams', 'Teams'],
      bundleId: 'com.microsoft.teams2',
      windowTitles: [/\| Microsoft Teams$/i, /Meeting with/i],
      excludeTitles: [/^Microsoft Teams$/i],
    },
    browser: {
      urlPatterns: [/teams\.microsoft\.com\/.*\/meetings/i, /teams\.live\.com/i],
      titlePatterns: [/\| Microsoft Teams$/i],
    },
  },
  meet: {
    browser: {
      urlPatterns: [/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i],
      titlePatterns: [/^Meet -/i, /- Google Meet$/i],
    },
  },
  slack: {
    native: {
      process: ['Slack'],
      // Slack has multiple bundle IDs depending on version/distribution
      bundleIds: ['com.tinyspeck.slackmacgap', 'com.slack.Slack'],
      windowTitles: [
        /Slack call with/i, 
        /Huddle/i,
        /Huddle with/i,
        /\| Huddle$/i,
      ],
      excludeTitles: [/^Slack$/i, /^Slack \|.*DM/i],
    },
  },
  webex: {
    native: {
      process: ['Webex', 'Cisco Webex Meetings'],
      bundleId: 'com.webex.meetingmanager',
      windowTitles: [/Webex Meeting/i, /Cisco Webex/i],
      excludeTitles: [/^Webex$/i],
    },
  },
};

const BROWSERS = ['Google Chrome', 'Safari', 'Firefox', 'Arc', 'Microsoft Edge', 'Brave Browser', 'Opera'];

export class MeetingWatcher {
  private native: NativeModule;
  private pollInterval: NodeJS.Timeout | null = null;
  private currentMeeting: MeetingInfo | null = null;
  private onMeetingDetected: ((meeting: MeetingInfo) => void) | null = null;
  private onMeetingEnded: (() => void) | null = null;
  private isRecordingLocked: boolean = false; // When true, don't auto-end browser meetings

  constructor(native: NativeModule) {
    this.native = native;
  }

  // Call this when recording starts to prevent auto-ending browser meetings
  setRecordingLock(locked: boolean) {
    this.isRecordingLocked = locked;
    console.log(`Meeting watcher recording lock: ${locked}`);
  }

  start(
    onMeetingDetected: (meeting: MeetingInfo) => void,
    onMeetingEnded: () => void
  ) {
    this.onMeetingDetected = onMeetingDetected;
    this.onMeetingEnded = onMeetingEnded;

    // Poll every 1 second
    this.pollInterval = setInterval(() => {
      this.checkForMeetings();
    }, 1000);

    // Initial check
    this.checkForMeetings();
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  getCurrentMeeting(): MeetingInfo | null {
    return this.currentMeeting;
  }

  private checkForMeetings() {
    try {
      const windows = this.native.getActiveWindows();
      const meeting = this.detectMeetingFromWindows(windows);

      if (meeting && !this.currentMeeting) {
        // New meeting detected
        this.currentMeeting = meeting;
        console.log(`Meeting detected: ${meeting.provider} (PID: ${meeting.pid}, browser: ${meeting.isBrowser})`);
        this.onMeetingDetected?.(meeting);
      } else if (meeting && this.currentMeeting) {
        // Update meeting info if window changed
        if (meeting.windowId !== this.currentMeeting.windowId) {
          this.currentMeeting = meeting;
          this.onMeetingDetected?.(meeting);
        }
      } else if (!meeting && this.currentMeeting) {
        if (this.currentMeeting.isBrowser) {
          // For browser meetings while recording: only end if browser closes
          // (Can't reliably detect meeting end when user switches tabs)
          if (this.isRecordingLocked) {
            // Only end if browser process is completely gone
            const browserStillRunning = this.isProcessRunning(this.currentMeeting.pid, windows);
            
            if (!browserStillRunning) {
              console.log(`Browser closed during recording - meeting ended`);
              this.currentMeeting = null;
              this.onMeetingEnded?.();
            }
            // Otherwise keep meeting active - user must click Stop Recording when done
          } else {
            // Not recording - check if any meeting window exists
            const anyMeetingWindow = this.hasAnyMeetingWindow(windows, this.currentMeeting.browserName);
            if (!anyMeetingWindow) {
              console.log(`No meeting windows found - meeting ended`);
              this.currentMeeting = null;
              this.onMeetingEnded?.();
            }
          }
        } else {
          // For native apps: end if meeting window is gone
          console.log(`Native meeting window closed - meeting ended`);
          this.currentMeeting = null;
          this.onMeetingEnded?.();
        }
      }
    } catch (e) {
      console.error('Error checking for meetings:', e);
    }
  }

  private isProcessRunning(pid: number, windows: Array<{ pid: number }>): boolean {
    return windows.some(w => w.pid === pid);
  }

  private hasAnyMeetingWindow(
    windows: Array<{ pid: number; windowId: number; ownerName: string; title: string; bundleId?: string }>,
    browserName?: string
  ): boolean {
    // Get the browser base name (e.g., "Google" from "Google Chrome")
    const browserBase = browserName?.split(' ')[0]?.toLowerCase();
    
    // Check all browser windows for any meeting-related titles
    for (const window of windows) {
      // Only check windows from browsers
      const isBrowser = BROWSERS.some(b => 
        window.ownerName.toLowerCase().includes(b.toLowerCase().split(' ')[0])
      );
      if (!isBrowser) continue;
      
      // Check if this window has a meeting title
      for (const [provider, patterns] of Object.entries(MEETING_PATTERNS)) {
        const browser = (patterns as any).browser;
        if (!browser?.titlePatterns) continue;
        
        const titleMatch = browser.titlePatterns.some((pattern: RegExp) =>
          pattern.test(window.title)
        );
        
        if (titleMatch) {
          console.log(`Found meeting window: "${window.title}" in ${window.ownerName}`);
          return true; // Found a meeting window
        }
      }
    }
    
    // Debug: log what windows we see
    const browserWindows = windows.filter(w => 
      BROWSERS.some(b => w.ownerName.toLowerCase().includes(b.toLowerCase().split(' ')[0]))
    );
    if (browserWindows.length > 0) {
      console.log(`Browser windows: ${browserWindows.map(w => `"${w.title}"`).join(', ')}`);
    }
    
    return false;
  }

  private detectMeetingFromWindows(
    windows: Array<{
      pid: number;
      windowId: number;
      ownerName: string;
      title: string;
      bundleId?: string;
    }>
  ): MeetingInfo | null {
    // Check Slack windows specifically for Huddles
    const slackWindows = windows.filter(w => 
      w.ownerName.toLowerCase().includes('slack')
    );
    
    // First, check for native meeting apps (including Slack with Huddle in title)
    for (const window of windows) {
      const nativeMeeting = this.checkNativeApp(window);
      if (nativeMeeting) {
        return nativeMeeting;
      }
    }
    
    // Special case: Slack Huddles are rendered inside the main window
    // Detect by checking if Slack is running + microphone is in use
    if (slackWindows.length > 0 && !this.currentMeeting) {
      try {
        const micInUse = this.native.isMicrophoneInUse();
        if (micInUse) {
          // Slack is running and microphone is active - likely a Huddle
          const mainSlackWindow = slackWindows.find(w => 
            w.title.includes('Slack') && !w.title.toLowerCase().startsWith('window')
          ) || slackWindows[0];
          
          // Extract participant name from DM window title if available
          // Format: "! Young Kim (DM) - Workspace - Slack" or "* Name (DM) - Workspace - Slack"
          let huddleTitle = 'Slack Huddle';
          const dmMatch = mainSlackWindow.title.match(/^[!*]?\s*([^(]+)\s*\(DM\)/i);
          if (dmMatch) {
            huddleTitle = `Huddle with ${dmMatch[1].trim()}`;
          }
          
          console.log(`[MeetingWatcher] Slack Huddle detected: "${huddleTitle}"`);
          
          return {
            provider: 'slack',
            title: huddleTitle,
            pid: mainSlackWindow.pid,
            windowId: mainSlackWindow.windowId,
            isBrowser: false,
            detectedAt: Date.now(),
          };
        }
      } catch (e) {
        // Microphone check failed, continue with other detection methods
      }
    }

    // Then, check for browser-based meetings
    for (const window of windows) {
      const browserMeeting = this.checkBrowserMeeting(window);
      if (browserMeeting) {
        return browserMeeting;
      }
    }

    return null;
  }

  private checkNativeApp(window: {
    pid: number;
    windowId: number;
    ownerName: string;
    title: string;
    bundleId?: string;
  }): MeetingInfo | null {
    for (const [provider, patterns] of Object.entries(MEETING_PATTERNS)) {
      const native = (patterns as any).native;
      if (!native) continue;

      // Check process name
      const processMatch = native.process.some(
        (p: string) => window.ownerName.toLowerCase().includes(p.toLowerCase())
      );
      
      // Check bundle ID if available (support single bundleId or array of bundleIds)
      let bundleMatch = false;
      if (window.bundleId) {
        if (native.bundleId) {
          bundleMatch = native.bundleId === window.bundleId;
        } else if (native.bundleIds) {
          bundleMatch = native.bundleIds.includes(window.bundleId);
        }
      }

      if (!processMatch && !bundleMatch) continue;

      // Check if it's an actual meeting window (not just the main app window)
      const titleMatches = native.windowTitles.some((pattern: RegExp) =>
        pattern.test(window.title)
      );
      const titleExcluded = native.excludeTitles?.some((pattern: RegExp) =>
        pattern.test(window.title)
      );


      if (titleMatches && !titleExcluded) {
        return {
          provider: provider as MeetingInfo['provider'],
          title: window.title,
          pid: window.pid,
          windowId: window.windowId,
          isBrowser: false,
          detectedAt: Date.now(),
        };
      }
    }

    return null;
  }

  private checkBrowserMeeting(window: {
    pid: number;
    windowId: number;
    ownerName: string;
    title: string;
    bundleId?: string;
  }): MeetingInfo | null {
    // Check if this is a browser
    const isBrowser = BROWSERS.some(
      (b) => window.ownerName.toLowerCase().includes(b.toLowerCase())
    );
    if (!isBrowser) return null;

    // Try to get URL from accessibility API (if available)
    let url: string | null = null;
    if (this.native.getBrowserUrl) {
      try {
        url = this.native.getBrowserUrl(window.pid);
      } catch (e) {
        // URL retrieval might fail if accessibility isn't granted
      }
    }

    for (const [provider, patterns] of Object.entries(MEETING_PATTERNS)) {
      const browser = (patterns as any).browser;
      if (!browser) continue;

      // Check window title patterns
      const titleMatch = browser.titlePatterns?.some((pattern: RegExp) =>
        pattern.test(window.title)
      );

      // Check URL patterns (if URL is available)
      const urlMatch = url && browser.urlPatterns?.some((pattern: RegExp) =>
        pattern.test(url!)
      );

      if (titleMatch || urlMatch) {
        // Generate a better title for browser meetings
        const betterTitle = this.generateMeetingTitle(window.title, provider, url);
        
        return {
          provider: provider as MeetingInfo['provider'],
          title: betterTitle,
          pid: window.pid,
          windowId: window.windowId,
          isBrowser: true,
          browserName: window.ownerName,
          url: url ?? undefined,
          detectedAt: Date.now(),
        };
      }
    }

    return null;
  }
  
  /**
   * Generate a better meeting title from window info
   * Fallback hierarchy: 
   * 1. Clean window title (if meaningful)
   * 2. Provider name + short URL/code
   * 3. Provider name + timestamp
   */
  private generateMeetingTitle(windowTitle: string, provider: string, url?: string | null): string {
    // Provider display names
    const providerNames: Record<string, string> = {
      'meet': 'Google Meet',
      'zoom': 'Zoom',
      'teams': 'Microsoft Teams',
      'slack': 'Slack Huddle',
      'webex': 'Webex',
    };
    
    const providerName = providerNames[provider] || provider;
    
    // Check if window title is meaningful (not just browser name or generic)
    const genericTitles = [
      'google chrome', 'chrome', 'safari', 'firefox', 'edge', 'brave',
      'meet', 'zoom', 'teams', 'window', 'untitled'
    ];
    
    const titleLower = windowTitle.toLowerCase().trim();
    const isGenericTitle = genericTitles.some(g => titleLower === g || titleLower.startsWith(g + ' -'));
    
    // Try to extract meeting name from window title
    // e.g., "Meeting with John - Google Meet" -> "Meeting with John"
    if (!isGenericTitle && windowTitle.length > 3) {
      // Remove provider/browser suffix
      let cleanTitle = windowTitle
        .replace(/\s*[-–|]\s*(Google Meet|Zoom|Microsoft Teams|Slack|Webex|Chrome|Safari|Firefox|Edge|Brave).*$/i, '')
        .replace(/\s*[-–|]\s*$/,'')
        .trim();
      
      // If we got a meaningful title, use it
      if (cleanTitle.length > 3 && !genericTitles.includes(cleanTitle.toLowerCase())) {
        return cleanTitle;
      }
    }
    
    // Try to extract meeting code from URL
    if (url) {
      // Google Meet: https://meet.google.com/abc-defg-hij
      const meetCodeMatch = url.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
      if (meetCodeMatch) {
        return `${providerName} (${meetCodeMatch[1]})`;
      }
      
      // Zoom: meeting ID in URL
      const zoomIdMatch = url.match(/zoom\.us\/j\/(\d+)/i);
      if (zoomIdMatch) {
        return `${providerName} (${zoomIdMatch[1].slice(-4)})`;
      }
      
      // Teams: extract meeting name or ID
      const teamsMatch = url.match(/teams\.microsoft\.com.*\/([^/?]+)/);
      if (teamsMatch && teamsMatch[1].length > 3) {
        return `${providerName} Call`;
      }
    }
    
    // Fallback: provider name with timestamp
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${providerName} ${timeStr}`;
  }
}

