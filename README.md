# OpenVoiceUI

A plug-and-play browser-based voice agent platform. Connect any LLM, any TTS provider, and any AI framework — with a built-in music player, AI music generation, and a live web canvas display system.

---

## What It Is

OpenVoiceUI is a modular voice UI shell. You bring the intelligence (LLM + TTS), it handles everything else:

- **Voice I/O** — browser-based STT with push-to-talk, wake words, or continuous mode
- **Animated Face** — responsive eye-face avatar with 7 mood states driven by emotion detection
- **Web Canvas** — fullscreen iframe display system for AI-generated HTML pages, dashboards, and reports
- **Music Player** — background music with crossfade, AI ducking, and AI trigger commands
- **Music Generation** — AI-generated track support via Suno or fal.ai integrations
- **Soundboard** — configurable sound effects with text-trigger detection
- **Agent Profiles** — switch personas/providers without restart via JSON config
- **Live Instruction Editor** — hot-reload system prompt from the admin panel
- **Admin Dashboard** — session control, playlist editor, face picker, theme editor

---

## Plug-and-Play Architecture

### LLM Providers
Connect to any LLM via the gateway adapter or add your own provider:

| Provider | Status |
|----------|--------|
| Any OpenClaw-compatible gateway | ✓ Built-in |
| Z.AI (GLM models) | ✓ Built-in |
| OpenAI-compatible APIs | ✓ Via adapter |
| Ollama (local) | ✓ Via adapter |
| Hume EVI | ✓ Built-in adapter |

### TTS Providers
| Provider | Type | Cost |
|----------|------|------|
| **Supertonic** | Local ONNX | Free |
| **Groq Orpheus** | Cloud, fast | ~$0.05/min |
| **Qwen3-TTS** | Cloud, expressive | ~$0.003/min |
| **Hume EVI** | Cloud, emotion-aware | ~$0.032/min |

### STT
- Web Speech API (browser-native, no API key needed)
- Whisper (local)
- Hume EVI (full-duplex)

---

## Features

### Voice Modes
- **Continuous** — always listening, silence timeout triggers send
- **Push-to-Talk** — hold button or configurable hotkey (keyboard/mouse)
- **Listen** — passive monitoring mode
- **Agent-to-Agent** — A2A communication panel

### Canvas System
- AI can open and display any HTML page in a fullscreen overlay
- Manifest-based page discovery with search, categories, and starred pages
- Triggered via `[CANVAS:page-id]` tags in AI responses
- Real-time SSE updates from server

### Music Player
- Background playlist with crossfade (1.5s smooth transitions)
- Auto-ducking during TTS (volume drops, restores after)
- AI voice commands: play, stop, skip, volume up/down
- Generated tracks (AI-composed) + custom playlists
- Track history (back button, 20-track buffer)

### Profile System
Define agents in JSON — each profile configures:
- LLM provider, model, parameters
- TTS voice, speed, parallel sentence mode
- STT silence timeout, PTT mode, wake words
- UI theme, face mood, enabled features
- Session key strategy

---

## Project Structure

```
├── server.py                   Entry point
├── app.py                      Flask app factory
├── routes/
│   ├── conversation.py         Voice + parallel TTS streaming
│   ├── canvas.py               Canvas display system
│   ├── instructions.py         Live system prompt editor
│   ├── music.py                Music control
│   ├── profiles.py             Agent profile management
│   ├── admin.py                Admin + server stats
│   └── ...
├── services/
│   ├── gateway.py              Gateway WebSocket connection
│   └── tts.py                  TTS service wrapper
├── tts_providers/              TTS provider implementations
├── providers/                  LLM/STT provider implementations
├── profiles/                   Agent profile JSON files
│   └── default.json            Base agent (edit to personalize)
├── prompts/
│   └── voice-system-prompt.md  Hot-reload system prompt
├── config/
│   ├── default.yaml            Server configuration
│   └── speech_normalization.yaml
├── src/
│   ├── app.js                  Frontend core (~5900 lines)
│   ├── adapters/               Adapter implementations
│   │   ├── ClawdBotAdapter.js
│   │   ├── hume-evi.js
│   │   ├── elevenlabs-classic.js
│   │   └── _template.js        Build your own adapter
│   ├── core/                   EventBus, VoiceSession, EmotionEngine
│   ├── features/               MusicPlayer, Soundboard
│   ├── shell/                  Orchestrator, bridges, profile discovery
│   ├── ui/                     AppShell, SettingsPanel, ThemeManager
│   └── providers/              WebSpeechSTT, TTSPlayer
├── sounds/                     Soundboard audio files
├── music/                      Music playlist folder
├── generated_music/            AI-generated tracks
└── canvas-manifest.json        Canvas page registry
```

---

## Quick Start

```bash
git clone https://github.com/MCERQUA/OpenVoiceUI-public
cd OpenVoiceUI-public
pip install -r backend/requirements.txt
cp .env.example .env
# Edit .env with your keys
python3 server.py
```

Open `http://localhost:5001` in your browser.

---

## Configuration

### Environment Variables

```bash
# Gateway / LLM
CLAWDBOT_GATEWAY_URL=ws://127.0.0.1:18791
CLAWDBOT_AUTH_TOKEN=your-token

# TTS — choose one or more
GROQ_API_KEY=your-groq-key          # Groq Orpheus TTS
FAL_KEY=your-fal-key                # Qwen3-TTS via fal.ai
SUPERTONIC_MODEL_PATH=/path/to/onnx # Local Supertonic TTS

# Hume EVI (optional full-duplex voice mode)
HUME_API_KEY=your-hume-key
HUME_CONFIG_ID=your-config-id

# Auth (optional — uses Clerk)
CLERK_PUBLISHABLE_KEY=pk_live_...

# Server
PORT=5001
```

### Personalizing Your Agent

Edit `profiles/default.json` to configure your agent:

```json
{
  "name": "My Assistant",
  "system_prompt": "You are a helpful voice assistant...",
  "llm": { "provider": "gateway", "model": "glm-4.7" },
  "voice": { "tts_provider": "groq", "voice_id": "tara" },
  "features": { "canvas": true, "music": true, "tools": true }
}
```

Edit `prompts/voice-system-prompt.md` to change the system prompt — changes are hot-reloaded with no restart.

---

## API Reference

```bash
# Health
GET  /health/live
GET  /health/ready

# Voice (streaming NDJSON)
POST /api/conversation?stream=1
     {"message": "Hello", "tts_provider": "groq", "voice": "tara"}

# Profiles
GET  /api/profiles
POST /api/profiles/activate  {"profile_id": "default"}

# Canvas
GET  /api/canvas/manifest

# Session
POST /api/session/reset  {"type": "hard"}

# TTS
GET  /api/tts/providers
POST /api/tts/generate  {"text": "Hello", "provider": "groq", "voice": "tara"}
```

---

## Building an Adapter

To connect a new LLM or voice framework, use `src/adapters/_template.js` as a starting point. Adapters implement a simple interface:

```js
export class MyAdapter {
  async init(bridge, config) { ... }
  async start() { ... }
  async stop() { ... }
  async destroy() { ... }
}
```

Register it in `src/shell/adapter-registry.js` and reference it in your profile JSON.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Python / Flask (blueprint architecture) |
| Frontend | Vanilla JS ES modules (no framework) |
| STT | Web Speech API / Whisper / Hume |
| TTS | Supertonic / Groq Orpheus / Qwen3 / Hume EVI |
| LLM | Any via gateway adapter |
| Canvas | Fullscreen iframe + SSE manifest system |
| Music Gen | Suno API / fal.ai |
| Auth | Clerk (optional) |

---

## License

MIT
