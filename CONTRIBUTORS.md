# Contributors

Thank you to everyone who has contributed to OpenVoiceUI.

---

## Core

**Mike Cerqua** ([@MCERQUA](https://github.com/MCERQUA)) — Project creator and maintainer

---

## Contributors

**Brad** ([@bradAGI](https://github.com/bradAGI))
- Refactored directory structure: consolidated `auth/`, `db/` into `services/`, added `services/paths.py` as single source of truth for all runtime paths, moved runtime data under `runtime/`

**Artale** ([@arosstale](https://github.com/arosstale))
- Atomic writes for JSON metadata files (greetings, playlists, generated music)
- Removed internal error details from HTTP/WebSocket responses
- Fixed systemd `Restart=on-failure` behavior
- Fixed nginx/certbot ordering on first-run SSL setup
