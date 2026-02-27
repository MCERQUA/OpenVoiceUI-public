"""
routes/vision.py — Camera / Vision / Facial Recognition Blueprint

Endpoints:
  POST /api/vision              — analyze camera frame with vision LLM
  POST /api/frame               — receive live frame (stored as latest_frame)
  POST /api/identify            — identify person from camera frame
  GET  /api/faces               — list registered faces
  POST /api/faces/<name>        — register a face photo
  DELETE /api/faces/<name>      — delete a registered face

Vision model is configurable per-profile via profile.vision.model.
Default: glm-4v-flash (free GLM vision model, ZhipuAI/Z.AI compatible).
"""

import base64
import json
import logging
import os
import re
import time
from io import BytesIO
from pathlib import Path

import requests
from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)

vision_bp = Blueprint('vision', __name__)

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

FACES_DIR = Path(__file__).parent.parent / 'faces'
FACES_DIR.mkdir(exist_ok=True)

# Latest frame received from browser (in-memory, ephemeral)
_latest_frame: dict = {'image': None, 'ts': 0}

# ---------------------------------------------------------------------------
# Vision model config
# ---------------------------------------------------------------------------

# Known vision-capable models (shown in admin UI dropdown)
VISION_MODELS = [
    {'id': 'glm-4v-flash',  'label': 'GLM-4V Flash (Free · Fast)',      'provider': 'zai'},
    {'id': 'glm-4v',        'label': 'GLM-4V (Better · Paid)',           'provider': 'zai'},
    {'id': 'glm-4v-plus',   'label': 'GLM-4V Plus (Best · Paid)',        'provider': 'zai'},
]

DEFAULT_VISION_MODEL    = os.environ.get('VISION_MODEL', 'glm-4v-flash')
DEFAULT_VISION_PROVIDER = 'zai'


def _get_vision_model() -> tuple[str, str]:
    """Return (model_id, provider) from active profile or env defaults."""
    try:
        from profiles.manager import get_profile_manager
        mgr = get_profile_manager()
        p   = mgr.get_active_profile()
        if p:
            d = p.to_dict()
            model    = d.get('vision', {}).get('model')    or DEFAULT_VISION_MODEL
            provider = d.get('vision', {}).get('provider') or DEFAULT_VISION_PROVIDER
            return model, provider
    except Exception as exc:
        logger.debug('Could not read vision config from profile: %s', exc)
    return DEFAULT_VISION_MODEL, DEFAULT_VISION_PROVIDER


def _call_vision(image_b64: str, prompt: str, model: str | None = None) -> str:
    """
    Send an image + prompt to the configured vision model and return the text response.

    image_b64 may be a raw base64 string or a data-URI (data:image/jpeg;base64,...).
    """
    if model is None:
        model, _ = _get_vision_model()

    # Strip data-URI prefix if present
    if image_b64.startswith('data:'):
        image_b64 = image_b64.split(',', 1)[1]

    api_key = os.environ.get('ZAI_API_KEY', '')
    if not api_key:
        raise ValueError('ZAI_API_KEY is not set — cannot call vision model')

    payload = {
        'model': model,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'image_url',
                 'image_url': {'url': f'data:image/jpeg;base64,{image_b64}'}},
                {'type': 'text', 'text': prompt},
            ],
        }],
        'max_tokens': 600,
    }

    resp = requests.post(
        'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type':  'application/json',
        },
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()['choices'][0]['message']['content'].strip()


# ---------------------------------------------------------------------------
# POST /api/vision  — agent "look at" tool
# ---------------------------------------------------------------------------

@vision_bp.route('/api/vision', methods=['POST'])
def vision_analyze():
    """Analyze a camera frame with the configured vision model."""
    data   = request.get_json(silent=True) or {}
    image  = data.get('image', '')
    prompt = data.get('prompt', 'Describe what you see in this image in detail.')
    model  = data.get('model')  # optional override

    if not image:
        return jsonify({'error': 'No image provided'}), 400

    try:
        description = _call_vision(image, prompt, model)
        return jsonify({'description': description, 'model': model or _get_vision_model()[0]})
    except Exception as exc:
        logger.error('Vision analysis failed: %s', exc)
        return jsonify({'error': str(exc)}), 500


# ---------------------------------------------------------------------------
# POST /api/frame  — receive live frame stream from browser
# ---------------------------------------------------------------------------

@vision_bp.route('/api/frame', methods=['POST'])
def receive_frame():
    """Store the latest camera frame in memory for use by other endpoints."""
    data  = request.get_json(silent=True) or {}
    image = data.get('image', '')
    if image:
        _latest_frame['image'] = image
        _latest_frame['ts']    = time.time()
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# POST /api/identify  — facial recognition
# ---------------------------------------------------------------------------

@vision_bp.route('/api/identify', methods=['POST'])
def identify_face():
    """
    Identify who is in the camera frame.

    Compares the submitted image against registered face photos using the
    vision model — no biometric library required.
    """
    data  = request.get_json(silent=True) or {}
    image = data.get('image', '')
    if not image:
        image = _latest_frame.get('image', '')
    if not image:
        return jsonify({'name': 'unknown', 'confidence': 0, 'message': 'No image'}), 200

    # Build list of registered faces
    face_entries = _list_faces_data()
    if not face_entries:
        return jsonify({'name': 'unknown', 'confidence': 0,
                        'message': 'No faces registered yet'}), 200

    # Build a short description list for the model
    names_str = ', '.join(e['name'] for e in face_entries)
    model, _ = _get_vision_model()

    prompt = (
        f"You are a facial recognition system. The registered people are: {names_str}.\n"
        "Look at the person in the image. If you can identify them as one of the "
        "registered people, respond with ONLY a JSON object like: "
        '{"name": "PersonName", "confidence": 85}\n'
        "If the person is not recognizable or not in the list, respond with: "
        '{"name": "unknown", "confidence": 0}\n'
        "Base confidence on how certain you are (0-100). No extra text."
    )

    try:
        raw = _call_vision(image, prompt, model)
        # Extract JSON from response
        m = re.search(r'\{[^}]+\}', raw)
        if m:
            result = json.loads(m.group())
            name       = result.get('name', 'unknown')
            confidence = int(result.get('confidence', 0))
            if name.lower() == 'unknown' or confidence < 40:
                return jsonify({'name': 'unknown', 'confidence': 0,
                                'message': 'Not recognized'})
            return jsonify({'name': name, 'confidence': confidence})
        return jsonify({'name': 'unknown', 'confidence': 0, 'message': 'Parse error'})
    except Exception as exc:
        logger.error('Face identification failed: %s', exc)
        return jsonify({'name': 'unknown', 'confidence': 0, 'message': str(exc)}), 200


# ---------------------------------------------------------------------------
# GET /api/faces  — list registered faces
# ---------------------------------------------------------------------------

def _list_faces_data():
    entries = []
    for face_dir in sorted(FACES_DIR.iterdir()):
        if not face_dir.is_dir():
            continue
        photos = list(face_dir.glob('*.jpg')) + list(face_dir.glob('*.jpeg')) + \
                 list(face_dir.glob('*.png'))
        entries.append({'name': face_dir.name, 'photo_count': len(photos)})
    return entries


@vision_bp.route('/api/faces', methods=['GET'])
def list_faces():
    return jsonify({'faces': _list_faces_data()})


# ---------------------------------------------------------------------------
# POST /api/faces/<name>  — register a face photo
# ---------------------------------------------------------------------------

@vision_bp.route('/api/faces/<name>', methods=['POST'])
def register_face(name):
    """Save a face photo for a named person."""
    # Sanitize name
    safe_name = re.sub(r'[^a-zA-Z0-9_\- ]', '', name).strip()
    if not safe_name:
        return jsonify({'error': 'Invalid name'}), 400

    data       = request.get_json(silent=True) or {}
    image_data = data.get('image', '')
    if not image_data:
        return jsonify({'error': 'No image provided'}), 400

    face_dir = FACES_DIR / safe_name
    face_dir.mkdir(exist_ok=True)

    # Strip data-URI prefix
    if image_data.startswith('data:'):
        image_data = image_data.split(',', 1)[1]

    # Save with incrementing filename
    idx      = len(list(face_dir.glob('*.jpg'))) + 1
    out_path = face_dir / f'photo_{idx:03d}.jpg'
    out_path.write_bytes(base64.b64decode(image_data))

    logger.info('Registered face photo: %s (%s)', safe_name, out_path.name)
    return jsonify({'ok': True, 'name': safe_name, 'file': out_path.name})


# ---------------------------------------------------------------------------
# DELETE /api/faces/<name>  — remove a registered face
# ---------------------------------------------------------------------------

@vision_bp.route('/api/faces/<name>', methods=['DELETE'])
def delete_face(name):
    safe_name = re.sub(r'[^a-zA-Z0-9_\- ]', '', name).strip()
    face_dir  = FACES_DIR / safe_name
    if not face_dir.exists():
        return jsonify({'error': 'Face not found'}), 404

    import shutil
    shutil.rmtree(face_dir)
    return jsonify({'ok': True, 'deleted': safe_name})


# ---------------------------------------------------------------------------
# GET /api/vision/models  — list available vision models (for admin UI)
# ---------------------------------------------------------------------------

@vision_bp.route('/api/vision/models', methods=['GET'])
def list_vision_models():
    active_model, _ = _get_vision_model()
    return jsonify({'models': VISION_MODELS, 'active': active_model})
