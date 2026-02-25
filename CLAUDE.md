# OpenVoiceUI — Agent System

> **Current state**: Modular voice agent platform. See SETUP.md for installation.

---

## Architecture Overview

```
server.py (thin orchestrator)
  └── app.py              Flask app factory (create_app())
  └── routes/             Flask blueprints
  │     ├── conversation.py   /api/conversation  ← MAIN VOICE ENDPOINT
  │     ├── instructions.py   /api/instructions  ← live instruction editor
  │     ├── music.py          /api/music
  │     ├── canvas.py         /api/canvas
  │     ├── admin.py          /api/admin, /api/server-stats
  │     ├── profiles.py       /api/profiles
  │     ├── theme.py          /api/theme
  │     ├── static_files.py   /sounds, /music, /src
  │     └── elevenlabs_hybrid.py
  └── services/
  │     ├── gateway.py        GatewayConnection (persistent WebSocket to OpenClaw)
  │     └── tts.py            TTS service wrapper
  └── tts_providers/          Concrete TTS provider implementations
  │     ├── base_provider.py
  │     ├── supertonic_provider.py
  │     ├── groq_provider.py      Groq Orpheus TTS
  │     ├── qwen3_provider.py     fal.ai Qwen3-TTS (needs FAL_KEY)
  │     ├── hume_provider.py      Hume EVI stub
  │     └── providers_config.json
  └── prompts/
  │     └── voice-system-prompt.md   ← HOT-RELOAD system prompt (edit anytime)
  └── config/
        ├── loader.py
        ├── default.yaml
        └── flags.yaml

src/app.js            Frontend (~5900 lines)
src/providers/WebSpeechSTT.js   Browser STT
src/admin.html        Admin dashboard (Agent Profiles, Instructions, etc.)
```

---

## Service Management

```bash
# Restart
sudo systemctl restart openvoiceui

# Logs
journalctl -u openvoiceui -f

# Status
systemctl status openvoiceui
```

---

## Primary Voice Path

### Flow
1. User speaks → `WebSpeechSTT` transcribes in browser
2. Silence timeout (1800ms) → sends to `/api/conversation`
3. POST `/api/conversation?stream=1` with `{message, tts_provider, voice, session_id}`
4. `routes/conversation.py` → `services/gateway.py` → persistent Gateway WS (WEBCHAT mode)
5. Gateway: LLM processes, uses tools if needed, streams response
6. Server collects full response, runs `clean_for_tts()`, splits into sentences
7. All sentences submitted to TTS threads simultaneously (parallel)
8. Audio chunks yielded in order → `{type:'audio', chunk:N, total_chunks:M}`
9. Frontend `audioQueue` plays chunks sequentially

### CRITICAL: Gateway Connection

```
Browser → POST /api/conversation → routes/conversation.py
  → services/gateway.py (GatewayConnection singleton, persistent WebSocket)
  → OpenClaw Gateway (CLAWDBOT_GATEWAY_URL) in WEBCHAT mode
  → LLM with full tools
  → response streamed → sentences TTS'd in parallel → JSON chunks returned
```

**DO NOT switch to direct API calls.** No tools, hits rate limits.

---

## TTS Provider System

### Provider Stack
1. **Supertonic** (local, free) — ONNX model, set `SUPERTONIC_MODEL_PATH` in `.env`
   - Voices: M1-M5 (male), F1-F5 (female)
2. **Groq Orpheus** (cloud, fast)
   - Model: `canopylabs/orpheus-v1-english`
   - Voices: `autumn`, `diana`, `hannah`, `austin`, `daniel`, `troy`, `tara`
   - Requires `GROQ_API_KEY`
3. **Qwen3** (cloud, fal.ai) — needs `FAL_KEY`

### No Silent Fallback
When a provider fails, error is shown to user. No automatic fallback.

---

## System Prompt (Hot-Reload)

**File:** `prompts/voice-system-prompt.md`

Edit this file — changes take effect on the next conversation request, no restart needed.
Lines starting with `#` are stripped before sending.

---

## Live Instruction Editor

**Admin panel:** `http://your-host/src/admin.html` → "Instructions" tab

**API:**
- `GET /api/instructions` — list all files
- `GET /api/instructions/<name>` — read file
- `PUT /api/instructions/<name>` — save file

---

## Agent Profiles

Profiles live in `profiles/` as JSON files. The schema is in `profiles/schema.json`.

Each profile configures:
- LLM provider/model/parameters
- TTS voice and speed
- STT settings (silence timeout, PTT mode, wake words)
- UI theme and features
- Session key strategy

Switch profiles via the Settings panel in the UI or `POST /api/profiles/<id>/activate`.

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/conversation?stream=1` | POST | Primary voice endpoint |
| `/api/tts/generate` | POST | Generate TTS only |
| `/api/tts/providers` | GET | List available TTS providers |
| `/api/session/reset` | POST | Reset session |
| `/api/instructions` | GET | List instruction files |
| `/api/instructions/<name>` | GET/PUT | Read/write instruction file |
| `/health/live` | GET | Liveness probe |
| `/health/ready` | GET | Readiness probe |
| `/api/server-stats` | GET | CPU, RAM, disk, uptime |
| `/api/profiles` | GET/POST | List / activate profiles |

---

## Streaming Event Protocol (NDJSON)

`POST /api/conversation?stream=1` returns newline-delimited JSON:

| Event type | Fields | When |
|------------|--------|------|
| `delta` | `text` | LLM streaming token |
| `action` | `action` | Tool use / canvas command |
| `text_done` | `response`, `actions`, `timing` | LLM finished |
| `audio` | `audio` (b64), `chunk`, `total_chunks`, `timing` | One TTS sentence |
| `tts_error` | `provider`, `reason`, `error` | TTS failed |
| `session_reset` | `old`, `new`, `reason` | Session auto-reset |
| `error` | `error` | Gateway/server error |

---

## Key Decisions

| Decision | Value |
|----------|-------|
| System prompt | External file, hot-reload, never hardcoded |
| TTS fallback | NONE — errors shown to user |
| TTS streaming | Parallel sentences post-LLM |
| STT silence | 1800ms (profile-configurable) |
| Session key | Persistent, prefix configurable per profile |
| Gateway | OpenClaw WEBCHAT mode |
