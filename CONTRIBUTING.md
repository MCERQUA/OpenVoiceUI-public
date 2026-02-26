# Contributing to OpenVoiceUI

Thanks for your interest in contributing. This is a voice agent platform — contributions that improve voice quality, add TTS providers, improve the frontend UX, or make setup easier are all welcome.

---

## Before You Start

OpenVoiceUI requires a running [OpenClaw](https://openclaw.dev) gateway to function. You can't test the voice pipeline without one. If you don't have one, you can still contribute to:

- Frontend UI (the face, settings panel, music player)
- TTS provider implementations (unit-testable in isolation)
- Documentation, setup scripts, tests
- Canvas system (HTML page display layer)

---

## Development Setup

```bash
git clone https://github.com/MCERQUA/OpenVoiceUI-public
cd OpenVoiceUI-public
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
routes/         Flask blueprints — one file per feature area
services/       Backend services (gateway WS connection, TTS wrapper)
tts_providers/  TTS provider implementations
src/            Frontend (vanilla JS ES modules)
  adapters/     LLM/voice framework adapters
  core/         EventBus, VoiceSession, EmotionEngine
  features/     MusicPlayer, Soundboard
  ui/           AppShell, SettingsPanel, ThemeManager
profiles/       Agent configuration JSON files
prompts/        System prompt (hot-reloaded, no restart needed)
config/         Server config YAML
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
