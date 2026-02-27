# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| main (latest) | ✅ |
| Older commits | ❌ |

OpenVoiceUI is pre-1.0 software. Security fixes are applied to `main` only.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, use [GitHub Security Advisories](https://github.com/MCERQUA/OpenVoiceUI-public/security/advisories/new) to report vulnerabilities privately. This ensures the issue is triaged and fixed before public disclosure.

If you don't have access to create advisories, email the maintainer directly (see GitHub profile).

### What to include

- Description of the vulnerability
- Steps to reproduce
- Impact assessment (who is affected, what can an attacker do)
- Suggested fix (if you have one)

### Response timeline

- **Acknowledgement:** within 72 hours
- **Triage:** within 1 week
- **Fix:** depends on severity — critical issues are patched ASAP

## Security Architecture

### Authentication

Auth is **opt-in** via [Clerk](https://clerk.com). Without `CLERK_PUBLISHABLE_KEY` set, the app runs fully open (designed for single-user / local deployments). When Clerk is configured, all API routes require a valid JWT.

### Rate Limiting

All endpoints are rate-limited via `flask-limiter` (per-IP, in-memory). Expensive endpoints (`/api/conversation`, `/api/upload`, `/api/stt/*`, `/api/tts/*`) have tighter limits. Override the global default via `RATELIMIT_DEFAULT` env var.

### File Serving

All file-serving routes use `_safe_path()` path traversal guards. Upload filenames are sanitized (regex + extension allowlist + timestamp prefix).

### Gateway Connection

The WebSocket connection to OpenClaw is authenticated via `CLAWDBOT_AUTH_TOKEN`. Device identity signing (Ed25519) is handled automatically on first connect.

### Headers

Security headers are set on all responses: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`.

## Known Limitations

- CSP uses `unsafe-inline` for scripts/styles (admin panel uses inline `<script>` blocks — planned for nonce-based refactor)
- Rate limiting uses in-memory storage (resets on restart; not shared across workers — use Redis URI via `RATELIMIT_STORAGE_URI` for production clusters)
