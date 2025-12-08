# Privacy Policy for IceCubes

**Last Updated: December 8, 2024**

## Overview

IceCubes is a desktop application that helps you take AI-powered meeting notes. We are committed to protecting your privacy and being transparent about our data practices.

## Data Collection and Storage

### What We Collect

IceCubes collects and processes the following data **locally on your device**:

1. **Audio Data**: Meeting audio is captured temporarily for real-time transcription
2. **Transcriptions**: Text transcriptions of your meetings
3. **Meeting Notes**: AI-generated summaries and your personal notes
4. **Calendar Data**: Meeting information from your connected Google Calendar (read-only)

### Where Data is Stored

- **All user data is stored locally** on your device in the application's data folder
- **No data is sent to our servers** - we don't operate any servers
- API calls are made directly from your device to:
  - OpenAI (for AI note generation)
  - Deepgram (for speech-to-text transcription)
  - Google Calendar API (for calendar integration)

### Data You Provide to Third-Party Services

When you use IceCubes, data is sent to third-party services **under your own API keys**:

| Service | Data Sent | Purpose |
|---------|-----------|---------|
| OpenAI | Meeting transcripts, notes | AI-powered note generation |
| Deepgram | Audio stream | Real-time transcription |
| Google | OAuth tokens | Calendar access |

**You are responsible for reviewing the privacy policies of these services:**
- [OpenAI Privacy Policy](https://openai.com/privacy)
- [Deepgram Privacy Policy](https://deepgram.com/privacy)
- [Google Privacy Policy](https://policies.google.com/privacy)

## Data Security

- **Local Encryption**: Sensitive data (API keys, OAuth tokens) is encrypted using your operating system's secure storage (macOS Keychain)
- **No Cloud Storage**: Your notes and transcripts never leave your device unless you explicitly export them
- **No Analytics**: We do not collect any usage analytics or telemetry

## Your Rights

You have complete control over your data:

- **Access**: All your data is stored locally and accessible to you
- **Delete**: Uninstalling the app removes all data, or you can manually delete the data folder
- **Export**: You can export your notes at any time

### Data Location

Your data is stored in:
- **macOS**: `~/Library/Application Support/icecubes/`

## Google Calendar Integration

IceCubes requests **read-only access** to your Google Calendar to:
- Display upcoming meetings
- Automatically detect when meetings start
- Show meeting attendees in your notes

We do **not**:
- Modify your calendar
- Store your calendar data on any server
- Share your calendar information with anyone

## Children's Privacy

IceCubes is not intended for use by children under 13 years of age.

## Changes to This Policy

We may update this Privacy Policy from time to time. We will notify you of any changes by updating the "Last Updated" date.

## Contact Us

If you have questions about this Privacy Policy, please open an issue on our GitHub repository.

---

**IceCubes** - Your meetings, your notes, your privacy.

