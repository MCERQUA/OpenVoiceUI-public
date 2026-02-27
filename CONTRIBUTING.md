# Contributing to OpenVoiceUI

Thanks for your interest in contributing. This is a voice agent platform — contributions that improve voice quality, add TTS providers, improve the frontend UX, or make setup easier are all welcome.

---

## Before You Start

The voice pipeline requires a running gateway. The default is [OpenClaw](https://openclaw.ai), but any gateway plugin works — including the `example-gateway` stub for offline development. If you don't have a gateway, you can still contribute to:

- Frontend UI (the face, settings panel, music player)
- TTS provider implementations (unit-testable in isolation)
- Documentation, setup scripts, tests
- Canvas system (HTML page display layer)

---

## Branch Workflow

| Branch | Purpose | Who pushes directly |
|--------|---------|---------------------|
| `main` | Stable, released code | Nobody — PR only, 1 review required |
| `dev`  | Integration / in-progress work | Maintainers only |

**Contributors always open PRs targeting `dev`**, not `main`.
Maintainers periodically merge `dev → main` to cut a release.

---

## Development Setup

```bash
git clone https://github.com/MCERQUA/OpenVoiceUI
cd OpenVoiceUI
python3 -m venv venv
venv/bin/pip install -r backend/requirements.txt
cp .env.example .env
# Edit .env — set CLAWDBOT_AUTH_TOKEN and GROQ_API_KEY at minimum
venv/bin/python3 server.py
```

Open `http://localhost:5001` in your browser.

---

## Project Structure

```
routes/             Flask blueprints — one file per feature area
services/           Backend services
  gateway_manager.py  Gateway registry, plugin loader, router
  gateways/           Gateway implementations
    base.py           GatewayBase abstract class
    openclaw.py       OpenClaw implementation
  tts.py            TTS service wrapper
tts_providers/      TTS provider implementations
plugins/            Gateway plugins (gitignored, drop-in)
  example-gateway/  Reference implementation
  README.md         Plugin authoring guide
src/                Frontend (vanilla JS ES modules)
  adapters/         LLM/voice framework adapters
  core/             EventBus, VoiceSession, EmotionEngine
  features/         MusicPlayer, Soundboard
  ui/               AppShell, SettingsPanel, ThemeManager
profiles/           Agent configuration JSON files
prompts/            System prompt (hot-reloaded, no restart needed)
config/             Server config YAML
```

---

## Adding a TTS Provider

1. Copy `tts_providers/base_provider.py` as a starting point
2. Implement `generate(text, voice, speed) -> bytes` (returns raw PCM or MP3)
3. Register it in `tts_providers/providers_config.json`
4. Add any required env vars to `.env.example`
5. Update the TTS provider table in `README.md`

---

## Adding an LLM Adapter

1. Copy `src/adapters/_template.js`
2. Implement the four lifecycle methods: `init`, `start`, `stop`, `destroy`
3. Register it in `src/shell/adapter-registry.js`
4. Document required config keys in your adapter's comments

---

## Adding a Gateway Plugin

Gateway plugins connect the server to any LLM backend (LangChain, AutoGen, direct API calls, etc.) and run alongside OpenClaw simultaneously.

1. Copy `plugins/example-gateway/` to `plugins/my-gateway/`
2. Edit `plugin.json` — set your `id` and any required env vars in `requires_env`
3. Implement `gateway.py` — subclass `GatewayBase`, implement `stream_to_queue()`
4. Restart the server — it auto-discovers plugins on startup
5. Set `"gateway_id": "my-gateway"` in a profile's `adapter_config` to route traffic to it

See [`plugins/README.md`](plugins/README.md) for the full event protocol and `gateway_manager.ask()` for inter-gateway calls.

---

## Code Style

**Python:**
- Follow existing patterns — Flask blueprints, logging via `logger = logging.getLogger(__name__)`
- No bare `print()` statements — use `logger.debug()` / `logger.info()`
- Add new env vars to `.env.example` with a comment explaining them

**JavaScript:**
- Vanilla ES modules, no build step required
- Follow the EventBus pattern for cross-component communication
- Keep adapters self-contained — no direct DOM manipulation outside `ui/`

---

## Submitting a PR

1. Fork the repo and create a branch: `git checkout -b feature/my-thing`
2. Make your changes
3. Test end-to-end locally (voice in → TTS audio out if relevant)
4. Submit a PR — fill out the PR template
5. Keep PRs focused — one feature or fix per PR

---

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).

Include logs from `journalctl -u openvoiceui -f` (production) or your terminal (development). The most useful logs are usually gateway connection errors or TTS provider errors.

---

## Questions

Open a [GitHub Discussion](../../discussions) or file an issue with the `question` label.
