# OpenAI-Compatible Gateway

Use **any** OpenAI Chat Completions-compatible API as the LLM backend for OpenVoiceUI — without needing OpenClaw.

## Supported Providers

| Provider | Base URL | Notes |
|----------|----------|-------|
| **OpenAI** | `https://api.openai.com/v1` (default) | GPT-4o, GPT-4o-mini, o1, etc. |
| **Groq** | `https://api.groq.com/openai/v1` | Llama, Mixtral — extremely fast |
| **Together** | `https://api.together.xyz/v1` | 100+ open models |
| **Fireworks** | `https://api.fireworks.ai/inference/v1` | Llama, Mixtral, custom fine-tunes |
| **OpenRouter** | `https://openrouter.ai/api/v1` | Multi-provider routing |
| **vLLM** | `http://localhost:8000/v1` | Self-hosted, GPU inference |
| **LiteLLM** | `http://localhost:4000/v1` | Proxy for 100+ providers |
| **Ollama** | `http://localhost:11434/v1` | Local models (requires Ollama ≥ 0.1.24) |

Any server that accepts `POST /chat/completions` with streaming SSE will work.

## Setup

Add these to your `.env`:

```bash
# Required
OPENAI_COMPAT_API_KEY=sk-your-key-here

# Optional — defaults shown
OPENAI_COMPAT_BASE_URL=https://api.openai.com/v1
OPENAI_COMPAT_MODEL=gpt-4o-mini
OPENAI_COMPAT_MAX_TOKENS=1024
```

### Example: Groq (free tier)

```bash
OPENAI_COMPAT_API_KEY=gsk_your-groq-key
OPENAI_COMPAT_BASE_URL=https://api.groq.com/openai/v1
OPENAI_COMPAT_MODEL=llama-3.3-70b-versatile
```

### Example: Local Ollama

```bash
OPENAI_COMPAT_API_KEY=ollama          # Ollama doesn't check this, but it must be set
OPENAI_COMPAT_BASE_URL=http://localhost:11434/v1
OPENAI_COMPAT_MODEL=llama3.2
```

### Example: vLLM (self-hosted)

```bash
OPENAI_COMPAT_API_KEY=token           # Your vLLM auth token (or dummy if no auth)
OPENAI_COMPAT_BASE_URL=http://localhost:8000/v1
OPENAI_COMPAT_MODEL=meta-llama/Llama-3.1-8B-Instruct
```

## Profile Configuration

Create or edit a profile to route voice requests through this gateway:

```json
{
  "id": "openai-agent",
  "name": "OpenAI Agent",
  "adapter": "clawdbot",
  "adapter_config": {
    "gateway_id": "openai-compat",
    "sessionKey": "openai-1"
  },
  "llm": {
    "provider": "gateway"
  },
  "voice": {
    "tts_provider": "groq",
    "voice_id": "tara",
    "speed": 1.1
  },
  "system_prompt": "You are a helpful voice assistant. Be conversational and concise."
}
```

## Features

- **Streaming** — tokens stream in real-time for low-latency TTS
- **Conversation memory** — maintains per-session chat history (last 20 messages)
- **System prompt** — uses `prompts/voice-system-prompt.md` (hot-reloadable) + profile system_prompt
- **Handshake timing** — reports time-to-first-token for diagnostics
- **Error handling** — connection errors, timeouts, and API errors reported cleanly

## Limitations

- No tool/function calling support (yet) — responses are text-only
- No streaming interruption (steer mode) — that requires OpenClaw's gateway protocol
- System prompt is loaded from file on each request (hot-reload friendly)
