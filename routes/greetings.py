"""
routes/greetings.py — Greetings API

GET  /api/greetings          — return full greetings.json
GET  /api/greetings/random   — return a single random greeting (optional ?user=mike)
POST /api/greetings/add      — append a contextual greeting (agent use)
"""

import json
import logging
import random
from pathlib import Path

from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)

greetings_bp = Blueprint('greetings', __name__)

GREETINGS_PATH = Path(__file__).parent.parent / 'greetings.json'


def _load() -> dict:
    try:
        with open(GREETINGS_PATH) as f:
            return json.load(f)
    except Exception as e:
        logger.error(f'Failed to load greetings.json: {e}')
        return {'greetings': {'generic': {'classic_annoyed': ['What do you want?']}, 'mike': {}, 'contextual': []}}


def _save(data: dict) -> None:
    """Persist greetings (atomic write)."""
    tmp = GREETINGS_PATH.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(GREETINGS_PATH)


@greetings_bp.route('/api/greetings', methods=['GET'])
def get_greetings():
    return jsonify(_load())


@greetings_bp.route('/api/greetings/random', methods=['GET'])
def random_greeting():
    """Return a random greeting. Pass ?user=mike for Mike-specific categories."""
    user = request.args.get('user', '').lower().strip()
    data = _load()
    greetings = data.get('greetings', {})

    pool = []

    # Check for a queued next_greeting first
    if data.get('next_greeting'):
        next_g = data['next_greeting']
        data['next_greeting'] = None
        _save(data)
        return jsonify({'greeting': next_g, 'category': 'queued', 'user': user})

    # Add contextual greetings (highest priority, 3x weight)
    contextual = greetings.get('contextual', [])
    pool.extend(contextual * 3)

    # Add user-specific greetings if recognized
    if user == 'mike':
        mike_cats = greetings.get('mike', {})
        for cat_greetings in mike_cats.values():
            pool.extend(cat_greetings)

    # Always add generic greetings
    generic_cats = greetings.get('generic', {})
    for cat_greetings in generic_cats.values():
        pool.extend(cat_greetings)

    if not pool:
        return jsonify({'greeting': 'What do you want?', 'category': 'fallback', 'user': user})

    greeting = random.choice(pool)
    return jsonify({'greeting': greeting, 'category': 'random', 'user': user})


@greetings_bp.route('/api/greetings/add', methods=['POST'])
def add_greeting():
    """Agent can queue a contextual greeting for the next session start."""
    body = request.get_json(silent=True) or {}
    greeting = (body.get('greeting') or '').strip()
    if not greeting:
        return jsonify({'ok': False, 'error': 'Missing greeting'}), 400
    if len(greeting) > 300:
        return jsonify({'ok': False, 'error': 'Greeting too long (max 300 chars)'}), 400

    data = _load()
    contextual = data['greetings'].get('contextual', [])
    contextual.append(greeting)
    data['greetings']['contextual'] = contextual[-20:]  # keep last 20
    _save(data)
    logger.info(f'Contextual greeting added: {greeting[:80]}')
    return jsonify({'ok': True, 'total_contextual': len(data['greetings']['contextual'])})
