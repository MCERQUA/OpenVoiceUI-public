"""
tests/test_theme.py — Tests for theme API endpoints (P4-T4)

Tests:
  GET  /api/theme        — returns current theme (defaults if unset)
  POST /api/theme        — saves valid theme colors
  POST /api/theme/reset  — resets to default colors
  POST /api/theme        — rejects invalid colors with 400

Uses a minimal Flask app with only theme_bp registered (not the full monolith).
"""

import json
import pytest
from flask import Flask


DEFAULT_PRIMARY = '#0088ff'
DEFAULT_ACCENT = '#00ffff'


@pytest.fixture(scope='module')
def theme_app(tmp_path_factory):
    """Minimal Flask app with theme_bp and a temp theme file."""
    tmp = tmp_path_factory.mktemp('theme')

    import routes.theme as theme_mod
    theme_mod.THEME_FILE = tmp / 'theme.json'

    from routes.theme import theme_bp
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.register_blueprint(theme_bp)
    return app


@pytest.fixture()
def tc(theme_app, tmp_path):
    """Test client with per-test temp theme file to ensure isolation."""
    import routes.theme as theme_mod
    theme_mod.THEME_FILE = tmp_path / 'theme.json'
    return theme_app.test_client()


def test_get_theme_returns_defaults(tc):
    """GET /api/theme returns default colors when no theme saved."""
    resp = tc.get('/api/theme')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['primary'] == DEFAULT_PRIMARY
    assert data['accent'] == DEFAULT_ACCENT


def test_set_theme_valid(tc):
    """POST /api/theme with valid colors saves and returns them."""
    payload = {'primary': '#ff0088', 'accent': '#ffcc00'}
    resp = tc.post('/api/theme',
                   data=json.dumps(payload),
                   content_type='application/json')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['primary'] == '#ff0088'
    assert data['accent'] == '#ffcc00'


def test_set_theme_persists(tc):
    """Theme saved via POST is returned by subsequent GET."""
    payload = {'primary': '#00ff88', 'accent': '#8800ff'}
    tc.post('/api/theme', data=json.dumps(payload), content_type='application/json')

    resp = tc.get('/api/theme')
    data = resp.get_json()
    assert data['primary'] == '#00ff88'
    assert data['accent'] == '#8800ff'


def test_set_theme_invalid_color(tc):
    """POST /api/theme with invalid hex returns 400."""
    bad_payloads = [
        {'primary': 'red', 'accent': '#00ffff'},
        {'primary': '#0088ff', 'accent': 'not-a-color'},
        {'primary': '#gggggg', 'accent': '#00ffff'},
        {'primary': '#fff', 'accent': '#00ffff'},  # shorthand not accepted
    ]
    for payload in bad_payloads:
        resp = tc.post('/api/theme',
                       data=json.dumps(payload),
                       content_type='application/json')
        assert resp.status_code == 400, f'Expected 400 for {payload}'


def test_reset_theme(tc):
    """POST /api/theme/reset returns default colors."""
    # Set a custom theme first
    tc.post('/api/theme',
            data=json.dumps({'primary': '#ff0000', 'accent': '#00ff00'}),
            content_type='application/json')

    # Reset
    resp = tc.post('/api/theme/reset')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['primary'] == DEFAULT_PRIMARY
    assert data['accent'] == DEFAULT_ACCENT

    # GET should also return defaults now
    resp2 = tc.get('/api/theme')
    data2 = resp2.get_json()
    assert data2['primary'] == DEFAULT_PRIMARY
