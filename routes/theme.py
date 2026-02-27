"""
routes/theme.py — Theme API Blueprint (P4-T4)

Provides server-side persistence for user theme preferences.

GET  /api/theme          — return current saved theme colors
POST /api/theme          — save theme colors (primary + accent)
POST /api/theme/reset    — reset to default theme

Theme is stored in config/theme.json
"""

import json
import logging
from pathlib import Path

from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)

theme_bp = Blueprint('theme', __name__)

_PROJECT_ROOT = Path(__file__).parent.parent
THEME_FILE = _PROJECT_ROOT / 'config' / 'theme.json'

DEFAULT_THEME = {
    'primary': '#0088ff',
    'accent': '#00ffff',
}


def _load_theme():
    """Load theme from file, returning defaults if not found."""
    try:
        if THEME_FILE.exists():
            data = json.loads(THEME_FILE.read_text())
            # Validate hex color format
            if _valid_hex(data.get('primary')) and _valid_hex(data.get('accent')):
                return data
    except Exception as e:
        logger.warning('Failed to load theme: %s', e)
    return dict(DEFAULT_THEME)


def _save_theme(theme):
    """Save theme to file."""
    THEME_FILE.parent.mkdir(parents=True, exist_ok=True)
    THEME_FILE.write_text(json.dumps(theme, indent=2))


def _valid_hex(color):
    """Return True if color is a valid #rrggbb hex string."""
    if not isinstance(color, str):
        return False
    import re
    return bool(re.fullmatch(r'#[0-9a-fA-F]{6}', color))


@theme_bp.get('/api/theme')
def get_theme():
    return jsonify(_load_theme())


@theme_bp.post('/api/theme')
def set_theme():
    data = request.get_json(silent=True) or {}
    primary = data.get('primary', '')
    accent = data.get('accent', '')

    if not _valid_hex(primary) or not _valid_hex(accent):
        return jsonify({'error': 'Invalid color format. Use #rrggbb hex values.'}), 400

    theme = {'primary': primary, 'accent': accent}
    _save_theme(theme)
    return jsonify(theme)


@theme_bp.post('/api/theme/reset')
def reset_theme():
    _save_theme(dict(DEFAULT_THEME))
    return jsonify(DEFAULT_THEME)
