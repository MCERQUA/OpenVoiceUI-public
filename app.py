"""
Flask application factory for ai-eyes2.

Usage:
    from app import create_app
    app, sock = create_app()

This factory pattern allows:
- Blueprint registration (Phase 2 tasks P2-T2 through P2-T8)
- Test isolation via config_override
- Clean extension initialization

ADR-009 (simple manager pattern): factory returns app + sock tuple so
server.py module-level decorators (@app.route, @sock.route) keep working.
"""
import logging
import os

from flask import Flask, jsonify, redirect, request
from flask_cors import CORS
from flask_sock import Sock

logger = logging.getLogger(__name__)

# Reduced from 100 MB — audio uploads don't need more than 25 MB (P7-T3 security audit)
_MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB


def create_app(config_override: dict = None):
    """
    Create and configure the Flask application.

    Args:
        config_override: Optional dict of Flask config values to apply.
                         Primarily used in tests to inject TESTING=True etc.

    Returns:
        tuple: (app, sock) — configured Flask app and Flask-Sock instance.
    """
    app = Flask(
        __name__,
        # Serve static files from project root (index.html etc.) via explicit routes
        static_folder=None,
    )

    # Core Flask config
    secret_key = os.getenv('SECRET_KEY')
    if not secret_key:
        import secrets as _secrets
        secret_key = _secrets.token_hex(32)
        logger.warning(
            'No SECRET_KEY set — generated a random key for this session. '
            'Sessions will NOT persist across restarts. '
            'Set SECRET_KEY in .env for production.'
        )
    app.config['SECRET_KEY'] = secret_key
    app.config['MAX_CONTENT_LENGTH'] = _MAX_UPLOAD_BYTES

    # Apply test / caller overrides last so they take precedence
    if config_override:
        app.config.update(config_override)

    # Initialize Flask-Sock for WebSocket support
    sock = Sock(app)

    # Configure CORS — allow your production domain and any localhost port for dev
    # Anchored regex prevents partial matches like http://localhostX.evil.com
    # Add extra origins via CORS_ORIGINS env var (comma-separated, e.g. https://yourdomain.com)
    _extra_origins = [o.strip() for o in os.getenv('CORS_ORIGINS', '').split(',') if o.strip()]
    CORS(app, origins=[
        r'^http://localhost:\d+$',
        *_extra_origins,
    ], supports_credentials=True)

    # ── Clerk auth gate ────────────────────────────────────────────────────────
    # Auth is only active when CLERK_PUBLISHABLE_KEY is set in .env.
    # Without it, the app runs fully open (single-user / local mode).
    _clerk_key = (os.getenv('CLERK_PUBLISHABLE_KEY') or os.getenv('VITE_CLERK_PUBLISHABLE_KEY', '')).strip()
    _auth_enabled = bool(_clerk_key)

    if not _auth_enabled:
        logger.info('No CLERK_PUBLISHABLE_KEY set — auth disabled (local mode)')
    else:
        # Routes that never require authentication:
        _PUBLIC_PREFIXES = (
            '/src/',       # static JS/CSS (needed to render the login screen)
            '/sounds/',
            '/music/',
            '/images/',    # canvas images (individual pages check their own flag)
            '/static/',    # PWA icons, app icons
            '/pages/',     # canvas pages — served without auth (CANVAS_REQUIRE_AUTH opt-in)
            '/api/canvas/',  # canvas API — creation, manifest, context (no per-user auth needed)
        )
        _PUBLIC_EXACT = {
            '/',           # main page — hosts the Clerk login gate itself
            '/pi',         # Pi-optimized page — same login gate, different entry point
            '/health/live',
            '/health/ready',
            '/api/auth/check',      # Auth check endpoint — does its own token verification
            '/api/suno/callback',   # Suno's servers POST here from external IPs (no Clerk token)
            '/sw.js',           # PWA service worker — browser fetches this before auth
            '/manifest.json',   # PWA manifest — browser fetches this before auth
            '/favicon.ico',     # Browser favicon request — before auth
            '/ws/clawdbot',     # WebSocket — browsers can't send Clerk token in WS headers;
                                # handler secures itself via CLAWDBOT_AUTH_TOKEN to the gateway
        }

        @app.before_request
        def require_auth():
            """Block unauthenticated requests to all non-exempt routes."""
            path = request.path

            # Always allow health probes and static assets
            if path in _PUBLIC_EXACT:
                return
            if any(path.startswith(p) for p in _PUBLIC_PREFIXES):
                return
            # Canvas pages and images have their own auth logic (public flag)
            # handled inside canvas_bp — let them through here
            if path.startswith('/pages/') or path.startswith('/canvas-proxy'):
                return

            from auth.middleware import get_token_from_request, verify_clerk_token
            token = get_token_from_request()
            user_id = verify_clerk_token(token) if token else None

            if not user_id:
                # For API calls return JSON 401; for page navigations redirect to /
                if path.startswith('/api/') or request.headers.get('X-Requested-With'):
                    return jsonify({'error': 'Unauthorized', 'code': 'auth_required'}), 401
                # HTML page request — redirect to root (login gate)
                return redirect('/')

    # ── Security headers (P7-T3 security audit) ──────────────────────────────
    @app.after_request
    def add_security_headers(response):
        """Add defensive HTTP security headers to every response."""
        response.headers.setdefault('X-Content-Type-Options', 'nosniff')
        response.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
        response.headers.setdefault('X-XSS-Protection', '1; mode=block')
        response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
        # Allow microphone for voice app; block camera/geolocation
        response.headers.setdefault(
            'Permissions-Policy', 'camera=(), microphone=(self), geolocation=()'
        )
        return response

    return app, sock
