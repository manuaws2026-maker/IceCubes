# Privacy Policy for IceCubes

**Last Updated: December 9, 2024**

## Overview

IceCubes is a desktop application that helps you take AI-powered meeting notes. We are committed to protecting your privacy and being transparent about our data practices.

**Key Privacy Commitment**: IceCubes processes all data locally on your device. We do not operate servers, and no user data is ever stored or transmitted to IceCubes servers.

## Data Collection and Storage

### What We Process

IceCubes processes the following data **entirely locally on your device**:

1. **Audio Data**: Meeting audio is captured temporarily for real-time transcription, then discarded
2. **Transcriptions**: Text transcriptions of your meetings stored locally
3. **Meeting Notes**: AI-generated summaries and your personal notes stored locally
4. **Calendar Data**: Meeting information from your connected Google Calendar (read-only access)

### No Server Storage

- **All user data is stored locally** on your device in the application's data folder
- **No data is ever sent to IceCubes servers** — we do not operate any servers
- **No cloud backup or sync** — your data stays on your device
- API calls are made directly from your device to third-party services you configure

### Data Ownership

**You retain full ownership of all your data.** IceCubes merely processes your data locally to provide its functionality. Your transcriptions, notes, and any other content created using the Application belong entirely to you.

## Third-Party Services

When you use IceCubes, data is sent to third-party services **using your own API keys or OAuth credentials**:

| Service | Data Sent | Purpose | Minimum Data |
|---------|-----------|---------|--------------|
| OpenAI | Meeting transcripts | AI-powered note generation | Only transcript text needed for summarization |
| Deepgram | Audio stream | Real-time transcription | Only audio during active recording |
| Google Calendar | OAuth tokens | Calendar read access | Only calendar event metadata (title, time, attendees) |

**Important**: Third-party APIs receive only the minimum data required to perform their function. We do not send any additional user data, analytics, or metadata to these services.

**You are responsible for reviewing the privacy policies of these services:**
- [OpenAI Privacy Policy](https://openai.com/privacy)
- [Deepgram Privacy Policy](https://deepgram.com/privacy)
- [Google Privacy Policy](https://policies.google.com/privacy)

## Google API Services Compliance

IceCubes' use of Google APIs complies with the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

Specifically:
- We only request **read-only access** to Google Calendar
- We use Google data **only** to display your upcoming meetings and detect meeting start times
- We do **not** store Google data on any external servers
- We do **not** share Google data with any third parties
- We do **not** use Google data for advertising or any purpose other than the app's core functionality

### Revoking Google Access

You can revoke IceCubes' access to your Google account at any time:

1. Go to [Google Account Permissions](https://myaccount.google.com/permissions)
2. Find "IceCubes" in the list of connected apps
3. Click "Remove Access"

After revoking access, IceCubes will no longer be able to read your calendar data.

## Data Security

- **Local Encryption**: Sensitive data (API keys, OAuth tokens) is encrypted using your operating system's secure storage (macOS Keychain)
- **No Cloud Storage**: Your notes and transcripts never leave your device unless you explicitly export them
- **No Analytics or Telemetry**: We do not collect any usage analytics, crash reports, or telemetry data
- **No Tracking**: We do not track your usage patterns or behavior

## Your Data Rights

You have complete control over your data:

| Right | How to Exercise |
|-------|-----------------|
| **Access** | All data is stored locally in accessible folders on your device |
| **Portability** | Export your notes at any time in standard formats |
| **Deletion** | Delete the data folder or uninstall the app to remove all data |
| **Correction** | Edit your notes directly within the application |
| **Restriction** | Disconnect services or stop recording at any time |

### Data Location

Your data is stored locally at:
- **macOS**: `~/Library/Application Support/icecubes/`

### Data Deletion

To completely delete all IceCubes data:
1. Uninstall the application, OR
2. Manually delete the data folder at the location above

Additionally, to remove calendar integration:
- Revoke access at [Google Account Permissions](https://myaccount.google.com/permissions)

## Google Calendar Integration

IceCubes requests **read-only access** to your Google Calendar to:
- Display upcoming meetings
- Automatically detect when meetings start
- Show meeting title and attendees in your notes

We do **not**:
- Modify your calendar in any way
- Store your calendar data on any external server
- Share your calendar information with anyone
- Use your calendar data for any purpose other than displaying meetings

## Children's Privacy

IceCubes is not intended for use by children under 13 years of age. We do not knowingly collect data from children.

## International Users

IceCubes processes all data locally on your device, regardless of your location. Since no data is transmitted to our servers, there are no cross-border data transfers by IceCubes. However, your use of third-party services (OpenAI, Deepgram, Google) may involve data transfers subject to those services' policies.

## Changes to This Policy

We may update this Privacy Policy from time to time. We will notify you of any changes by updating the "Last Updated" date at the top of this policy.

## Contact Us

If you have questions about this Privacy Policy or our data practices, please contact us:

- **Email**: septembermanu@gmail.com
- **GitHub**: [Open an issue](https://github.com/manuaws2026-maker/IceCubes/issues)

---

**IceCubes** — Your meetings, your notes, your device, your privacy.
