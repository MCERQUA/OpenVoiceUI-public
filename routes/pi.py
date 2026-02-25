"""
routes/pi.py — Raspberry Pi optimized page serving

Purely additive — register with:
    from routes.pi import pi_bp
    app.register_blueprint(pi_bp)

UA detection targets (ARM architecture strings in User-Agent):
    aarch64 — Pi 4, Pi 5, Pi Zero 2 W (64-bit ARM)
    armv7l  — Pi 3, Pi 2 (32-bit ARM)
    armv6l  — Pi Zero, Pi 1 (ARMv6)

The before_app_request hook fires on every request but only acts on
GET / from ARM browsers, redirecting them transparently to /pi which
serves index-pi.html — the performance-optimized variant.

Desktop/non-ARM browsers are completely unaffected.
"""

import os
import pathlib

from flask import Blueprint, Response, redirect, request, url_for

pi_bp = Blueprint('pi', __name__)

BASE_DIR = pathlib.Path(__file__).parent.parent

_PI_UA_MARKERS = ('aarch64', 'armv7l', 'armv6l')


def _is_pi_ua(ua: str) -> bool:
    """Return True if the User-Agent string indicates an ARM/Pi browser."""
    return any(marker in (ua or '').lower() for marker in _PI_UA_MARKERS)


@pi_bp.before_app_request
def redirect_pi_browsers():
    """Redirect ARM browsers visiting / to the Pi-optimized /pi page."""
    if request.method == 'GET' and request.path == '/':
        if _is_pi_ua(request.headers.get('User-Agent', '')):
            return redirect(url_for('pi.serve_pi_index'), code=302)


@pi_bp.route('/pi')
def serve_pi_index():
    """
    Serve index-pi.html with the same AGENT_CONFIG injection used by
    the main serve_index() in server.py.
    """
    html = (BASE_DIR / 'index-pi.html').read_text()

    server_url = os.environ.get('AGENT_SERVER_URL', '').strip().rstrip('/')
    if server_url:
        config_block = f'<script>window.AGENT_CONFIG={{serverUrl:"{server_url}"}};</script>'
    else:
        config_block = '<script>window.AGENT_CONFIG={serverUrl:window.location.origin};</script>'

    html = html.replace('</head>', f'  {config_block}\n</head>', 1)
    resp = Response(html, mimetype='text/html')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp
