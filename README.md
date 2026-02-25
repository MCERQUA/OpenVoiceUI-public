# OpenVoiceUI — v3.1

A modular browser-based voice agent platform. Dual-mode: local free voice via OpenClaw Gateway, or premium voice via Hume EVI.

| Mode | Agent | Backend | Use Case |
|------|-------|---------|----------|
| **Pi-Guy** (PRIMARY) | Clawdbot | OpenClaw Gateway + Z.AI GLM-4.7 | Free local voice agent |
| **DJ-FoamBot** | DJ-FoamBot | Hume EVI v3 + custom voice | Secondary/premium mode |

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Backend | Flask (blueprint architecture) |
| Frontend | ES modules (no framework) |
| LLM | Z.AI GLM-4.7 via OpenClaw Gateway (WEBCHAT mode) |
| STT | Web Speech API (3s silence timeout) |
| TTS (primary) | Supertonic ONNX (local, free) |
| TTS (cloud) | Groq Orpheus (`canopylabs/orpheus-v1-english`) |
| TTS (alt) | Qwen3 via fal.ai |
| Canvas | Fullscreen iframe + page manifest system |
| Face/mood | Custom EyeFace + EmotionEngine |

---

## Features

- **Voice Conversation** — STT → LLM → parallel TTS pipeline, first audio ~1s after LLM done
- **Animated Face** — 7 mood states driven by EmotionEngine
- **Canvas System** — Fullscreen iframe display for AI-generated HTML pages
- **Music Player** — Tracks with crossfade and ducking
- **DJ Soundboard** — Air horns, scratches, clips, text triggers
- **Profile Switching** — Switch agents without restart
- **Live Instruction Editor** — Edit system prompt with hot-reload
- **Admin Dashboard** — Session reset, playlist editor, face picker, theme editor

---

## Project Structure

```
├── server.py               Entry point + Flask app
├── app.py                  Flask app factory (create_app())
├── routes/
│   ├── conversation.py     Voice conversation + parallel TTS streaming
│   ├── canvas.py           Canvas display, manifest, proxy
│   ├── instructions.py     Live instruction editor
│   ├── music.py            Music control
│   ├── admin.py            Admin + server stats
│   ├── profiles.py         Agent profiles
│   ├── theme.py            Theming
│   └── static_files.py     Static file serving
├── services/
│   ├── gateway.py          OpenClaw Gateway (persistent WebSocket)
│   └── tts.py              TTS service wrapper
├── tts_providers/
│   ├── supertonic_provider.py
│   ├── groq_provider.py
│   ├── qwen3_provider.py
│   └── providers_config.json
├── profiles/               Agent profile JSON files
├── prompts/
│   └── voice-system-prompt.md   Hot-reload system prompt
├── config/
│   ├── default.yaml
│   └── flags.yaml
├── src/
│   ├── app.js              Frontend
│   ├── providers/WebSpeechSTT.js
│   ├── ui/AppShell.js
│   └── styles/base.css
└── canvas-manifest.json    Canvas page registry
```

---

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in your keys
python3 server.py
```

---

## Environment Variables

```bash
# OpenClaw Gateway (Pi-Guy mode)
CLAWDBOT_AUTH_TOKEN=your-token
CLAWDBOT_GATEWAY_URL=ws://127.0.0.1:18791

# TTS
GROQ_API_KEY=your-groq-key
FAL_KEY=your-fal-key

# Hume EVI (DJ-FoamBot mode — optional)
HUME_API_KEY=your-hume-key
HUME_SECRET_KEY=your-hume-secret
HUME_CONFIG_ID=your-config-id
HUME_VOICE_ID=your-voice-id

# Server
PORT=15001
```

---

## API Quick Reference

```bash
# Health
GET  /health/live
GET  /health/ready

# Voice conversation (streaming NDJSON)
POST /api/conversation?stream=1
     {"message": "Hello", "tts_provider": "groq", "voice": "daniel", "session_id": "test"}

# Profiles
GET  /api/profiles
POST /api/profiles/activate  {"name": "pi-guy"}

# Canvas
GET  /api/canvas/manifest
POST /api/canvas/manifest/sync

# Session
POST /api/session/reset  {"type": "hard"}
```

---

## Credits

- [OpenClaw](https://github.com/openclaw) — Gateway / agent framework
- [Z.AI](https://z.ai) — GLM-4.7 LLM
- [Groq](https://groq.com) — Orpheus TTS
- [Supertonic](https://github.com/supertonic) — Local ONNX TTS
- [Hume AI](https://hume.ai) — EVI (optional secondary mode)
