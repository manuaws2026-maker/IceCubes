# 🧊 IceCubes

**AI-powered meeting notes that help you focus on the conversation.**

IceCubes is a macOS desktop application that automatically transcribes your meetings in real-time and generates intelligent, structured notes using AI.

![IceCubes Screenshot](assets/logo.png)

## ✨ Features

- **🎙️ Real-time Transcription** - Captures both your voice and meeting audio with speaker separation
- **🤖 AI-Powered Notes** - Automatically generates structured meeting summaries, key points, and action items
- **📅 Calendar Integration** - Connects with Google Calendar to detect meetings automatically
- **📁 Smart Organization** - AI suggests folders for your notes based on content
- **🔍 Full-Text Search** - Search across all your notes, people, and companies
- **👥 People & Companies** - Automatically tracks meeting participants and their organizations
- **📝 Custom Templates** - Create your own note templates (1:1s, standups, interviews, etc.)
- **🌍 Multilingual** - Supports multiple languages for transcription and notes
- **🔒 Privacy-First** - All data stored locally on your device

## 🚀 Getting Started

### Prerequisites

- macOS 10.15 or later (Apple Silicon or Intel)
- [OpenAI API Key](https://platform.openai.com/api-keys) - for AI note generation
- [Deepgram API Key](https://console.deepgram.com/) - for transcription
- [Google Cloud Project](https://console.cloud.google.com/) - for Calendar integration (optional)

### Installation

#### Option 1: Download Release (Recommended)

1. Download the latest `.dmg` from [Releases](../../releases)
2. Open the DMG and drag IceCubes to Applications
3. Launch IceCubes and configure your API keys in Settings

#### Option 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/yourusername/icecubes.git
cd icecubes

# Install dependencies
npm install

# Build the native module
cd src-native && npm run build && cd ..

# Build and run
npm run build
npm start
```

### Configuration

1. **OpenAI API Key**: Settings → API Keys → Enter your OpenAI key
2. **Deepgram API Key**: Settings → API Keys → Enter your Deepgram key
3. **Google Calendar** (optional): Settings → Calendar → Connect Google Account

## 🎯 Usage

### Recording a Meeting

1. Click **New** to start a new note
2. Click the **Record** button or let IceCubes auto-detect your meeting
3. Take notes while the meeting is transcribed in real-time
4. Click **Stop** when done
5. Click **Generate Notes** to create AI-powered summaries

### Features Overview

| Feature | Description |
|---------|-------------|
| **Raw Notes** | Your manual notes during the meeting |
| **AI Notes** | Auto-generated structured summaries |
| **Transcript** | Full meeting transcription with timestamps |
| **Templates** | Choose from built-in or custom note formats |
| **Folders** | Organize notes by project, team, or topic |

## 🛠️ Development

### Tech Stack

- **Electron** - Cross-platform desktop framework
- **TypeScript** - Type-safe JavaScript
- **Rust** - Native macOS audio capture module
- **TipTap** - Rich text editor
- **SQLite** - Local database with FTS5 search
- **Vite** - Fast build tooling

### Project Structure

```
icecubes/
├── src/
│   ├── main/           # Electron main process
│   │   ├── index.ts    # Main entry point
│   │   ├── calendar.ts # Google Calendar integration
│   │   ├── openai.ts   # AI note generation
│   │   └── ...
│   └── renderer/       # Frontend UI
│       └── editor.html # Main editor interface
├── src-native/         # Rust native module
│   └── src/
│       └── lib.rs      # macOS audio capture
├── assets/             # Icons and images
└── build/              # Build configuration
```

### Building

```bash
# Development
npm run dev

# Production build
npm run build

# Create distributable
npm run dist:mac
```

### Environment Variables

Create a `.env` file (see `env.example`):

```bash
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

## 📄 Legal

- [Privacy Policy](PRIVACY_POLICY.md)
- [Terms of Service](TERMS_OF_SERVICE.md)

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## 🙏 Acknowledgments

- [OpenAI](https://openai.com) - GPT models for AI note generation
- [Deepgram](https://deepgram.com) - Real-time speech-to-text
- [Electron](https://electronjs.org) - Desktop app framework
- [TipTap](https://tiptap.dev) - Rich text editor

---

**Made with ❄️ by the IceCubes team**
