# 🧊 IceCubes (www.AppOptima.com / www.IceCubes.App)

**AI-powered meeting notes that help you focus on the conversation.**

IceCubes is a macOS desktop application that automatically transcribes your meetings in real-time and generates intelligent, structured notes using AI. Run everything locally or bring your own API keys.

![IceCubes Screenshot](assets/logo.png)

## ✨ Features

- **🎙️ Real-time Transcription** - Captures both your voice and meeting audio with speaker separation
- **🤖 AI-Powered Notes** - Automatically generates structured meeting summaries, key points, and action items
- **🏠 100% Local Mode** - Run everything on your Mac with Parakeet (transcription) and Qwen 2.5 (AI notes). No internet required.
- **📅 Calendar Integration** - Connects with Google Calendar to detect meetings automatically
- **📁 Smart Organization** - AI suggests folders for your notes based on content
- **🔍 Full-Text Search** - Search across all your notes, people, and companies
- **👥 People & Companies** - Automatically tracks meeting participants and their organizations
- **📝 Custom Templates** - Create your own note templates (1:1s, standups, interviews, etc.)
- **🌍 Multilingual** - Supports multiple languages for transcription and notes
- **🔒 Privacy-First** - All data stored locally on your device. Your meetings never leave your Mac.

## 🚀 Getting Started

### Prerequisites

- macOS 12.0 or later (Apple Silicon recommended)
- **No API keys required** for local mode

### Choose Your Mode

| Mode | Transcription | AI Notes | Internet Required |
|------|--------------|----------|-------------------|
| **🏠 Local** | Parakeet | Qwen 2.5 | No |
| **🔑 Cloud** | Deepgram | OpenAI | Yes |

### Installation

#### Option 1: Download Release (Recommended)

1. Download the latest `.dmg` from [Releases](https://github.com/manuaws2026-maker/IceCubes/releases/latest)
2. Open the DMG and drag IceCubes to Applications
3. Launch IceCubes and grant permissions (Microphone, Screen Recording, Accessibility)
4. Choose Local Mode or configure API keys in Settings

#### Option 2: Build from Source

```bash
# Clone the repository
git clone https://github.com/manuaws2026-maker/IceCubes.git
cd IceCubes

# Install dependencies
npm install

# Build the native module
cd src-native && npm run build && cd ..

# Build and run
npm run build
npm start
```

### Configuration

#### Local Mode (Default)
IceCubes works out of the box with local models. No configuration needed! The first time you use local transcription or AI notes, the models will be downloaded automatically.

#### Cloud Mode (Optional)
If you prefer cloud services for faster processing:
1. **Deepgram API Key**: Settings → Transcription → Engine → Deepgram
2. **OpenAI API Key**: Settings → AI Engine → OpenAI
3. **Google Calendar** (optional): Settings → Calendar → Connect Google Account

## 🎯 Usage

### Recording a Meeting

1. Click **New** to start a new note
2. Click the **Record** button or let IceCubes auto-detect your Zoom/Google Meet
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
- **Rust** - Native macOS audio capture & local AI inference
- **TipTap** - Rich text editor
- **SQLite** - Local database with FTS5 search
- **Vite** - Fast build tooling
- **Qwen 2.5** - Local LLM for AI notes
- **Parakeet** - Local speech-to-text model

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
│       ├── lib.rs      # Module exports
│       ├── audio.rs    # macOS audio capture
│       ├── llm.rs      # Local Qwen inference
│       └── whisper.rs  # Local Parakeet transcription
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

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

## 📄 Legal

- [Privacy Policy](PRIVACY_POLICY.md)
- [Terms of Service](TERMS_OF_SERVICE.md)

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## 🙏 Acknowledgments

- [Qwen](https://github.com/QwenLM/Qwen) - Local LLM for AI notes
- [NVIDIA Parakeet](https://huggingface.co/nvidia/parakeet-tdt-1.1b) - Local speech-to-text
- [OpenAI](https://openai.com) - Cloud AI option
- [Deepgram](https://deepgram.com) - Cloud transcription option
- [Electron](https://electronjs.org) - Desktop app framework
- [TipTap](https://tiptap.dev) - Rich text editor

---

**Made with ❄️ by the IceCubes team**
