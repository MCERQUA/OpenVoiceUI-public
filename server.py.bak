#!/usr/bin/env python3
"""
OpenVoiceUI Server
Voice agent backend using Hume AI EVI for voice, Gemini for vision.
Also handles face recognition using DeepFace and user usage tracking.

This is the cost-optimized version of Pi-Guy, using Hume instead of ElevenLabs.
"""

import os
import base64
import json
import shutil
import tempfile
import sqlite3
import faulthandler
faulthandler.enable()  # Print traceback on SIGSEGV, SIGFPE, SIGABRT, SIGBUS, SIGILL
import subprocess
import time
import threading
import queue
import logging
import psutil
import re
import random
import requests
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from flask_sock import Sock
from dotenv import load_dotenv

import google.generativeai as genai
import websockets
import asyncio
import uuid
from faster_whisper import WhisperModel
from services.gateway import gateway_connection
from services.tts import (
    get_groq_client as _tts_get_groq_client,
    generate_tts_b64 as _tts_generate_b64,
)


# Load environment variables (use explicit path to avoid picking up parent .env files)
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path, override=True)

logger = logging.getLogger(__name__)

# Server start time for uptime tracking
SERVER_START_TIME = time.time()


# ===== CONVERSATION HISTORY FOR DIRECT Z.AI CALLS =====
conversation_histories = {}



# Faster-Whisper model for STT (lazy-loaded on first use to save memory)
whisper_model = None

def get_whisper_model():
    global whisper_model
    if whisper_model is None:
        print('Loading Faster-Whisper tiny model for local STT...')
        whisper_model = WhisperModel('tiny', device='cpu', compute_type='float32')
        print('✓ Faster-Whisper model loaded')
    return whisper_model

# Use app factory — CORS and Flask-Sock are configured inside create_app()
from app import create_app
app, sock = create_app()

# Register blueprints (Phase 2 — blueprint split)
from routes.music import music_bp
app.register_blueprint(music_bp)

from routes.canvas import (
    canvas_bp,
    canvas_context,
    update_canvas_context,
    extract_canvas_page_content,
    get_canvas_context_for_piguy,
    load_canvas_manifest,
    save_canvas_manifest,
    add_page_to_manifest,
    sync_canvas_manifest,
    CANVAS_MANIFEST_PATH,
    CANVAS_PAGES_DIR,
    CATEGORY_ICONS,
    CATEGORY_COLORS,
)
app.register_blueprint(canvas_bp)

from routes.static_files import static_files_bp, DJ_SOUNDS, SOUNDS_DIR
app.register_blueprint(static_files_bp)

from routes.admin import admin_bp
app.register_blueprint(admin_bp)

from routes.theme import theme_bp
app.register_blueprint(theme_bp)

from routes.conversation import conversation_bp, clean_for_tts
app.register_blueprint(conversation_bp)

from routes.profiles import profiles_bp
app.register_blueprint(profiles_bp)

from routes.elevenlabs_hybrid import elevenlabs_hybrid_bp
app.register_blueprint(elevenlabs_hybrid_bp)

from routes.instructions import instructions_bp
app.register_blueprint(instructions_bp)

from routes.greetings import greetings_bp
app.register_blueprint(greetings_bp)

from routes.suno import suno_bp
app.register_blueprint(suno_bp)

from routes.transcripts import transcripts_bp
app.register_blueprint(transcripts_bp)

from routes.pi import pi_bp
app.register_blueprint(pi_bp)

# Auto-sync canvas manifest on startup to catch any pages created outside the API
try:
    sync_canvas_manifest()
    logging.getLogger(__name__).info('Canvas manifest auto-synced on startup')
except Exception as _e:
    logging.getLogger(__name__).warning(f'Canvas manifest auto-sync failed (non-critical): {_e}')

# ===== VOICE SESSION MANAGEMENT =====
# Session key for OpenClaw Gateway — persistent across server restarts
# Bump the number to get a fresh agent context (fixes corrupted sessions)
VOICE_SESSION_FILE = os.path.join(os.path.dirname(__file__), '.voice-session-counter')
_consecutive_empty_responses = 0

def get_voice_session_key():
    """Get the current voice session key (e.g., 'voice-main-6')."""
    try:
        with open(VOICE_SESSION_FILE, 'r') as f:
            counter = int(f.read().strip())
    except (FileNotFoundError, ValueError):
        counter = 6  # Current value as of Feb 19 2026
        _save_session_counter(counter)
    return f'voice-main-{counter}'

def _save_session_counter(counter):
    with open(VOICE_SESSION_FILE, 'w') as f:
        f.write(str(counter))

def bump_voice_session():
    """Increment session counter — returns new session key."""
    global _consecutive_empty_responses
    try:
        with open(VOICE_SESSION_FILE, 'r') as f:
            counter = int(f.read().strip())
    except (FileNotFoundError, ValueError):
        counter = 6
    counter += 1
    _save_session_counter(counter)
    _consecutive_empty_responses = 0
    new_key = f'voice-main-{counter}'
    logger.info(f"### SESSION RESET: bumped to {new_key}")
    return new_key


# ===== USER USAGE TRACKING =====
MONTHLY_LIMIT = 20  # Max agent responses per user per month
UNLIMITED_USERS = ['user_365rT7sUqN11BDW5TTlt0FAMZWo']  # Mike - unlimited for testing
DB_PATH = Path(__file__).parent / "usage.db"

# --- P1-T5: SQLite WAL + connection pool (Recipe R2) ---
from db.pool import SQLitePool
db_pool = SQLitePool(DB_PATH, pool_size=5)
# --- end P1-T5 ---

def init_db():
    """Initialize the usage database"""
    conn = sqlite3.connect(DB_PATH)
    # Ensure WAL mode is active (idempotent; safe to call every startup)
    conn.execute("PRAGMA journal_mode=WAL")
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS usage (
            user_id TEXT PRIMARY KEY,
            message_count INTEGER DEFAULT 0,
            month TEXT,
            updated_at TEXT
        )
    ''')
    # Jobs table for scheduled tasks
    c.execute('''
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            job_type TEXT NOT NULL,
            schedule_type TEXT NOT NULL,
            cron_expression TEXT,
            next_run TEXT,
            last_run TEXT,
            status TEXT DEFAULT 'pending',
            action TEXT NOT NULL,
            action_params TEXT,
            result TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    ''')
    # Job history table
    c.execute('''
        CREATE TABLE IF NOT EXISTS job_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER,
            run_at TEXT,
            status TEXT,
            result TEXT,
            duration_ms INTEGER,
            FOREIGN KEY (job_id) REFERENCES jobs(id)
        )
    ''')
    # Conversation log table
    c.execute('''
        CREATE TABLE IF NOT EXISTS conversation_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT DEFAULT 'default',
            role TEXT NOT NULL,
            message TEXT NOT NULL,
            tts_provider TEXT,
            voice TEXT,
            created_at TEXT
        )
    ''')
    # Conversation metrics table — timing instrumentation for every request
    c.execute('''
        CREATE TABLE IF NOT EXISTS conversation_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT DEFAULT 'default',
            profile TEXT,
            model TEXT,
            handshake_ms INTEGER,
            llm_inference_ms INTEGER,
            tts_generation_ms INTEGER,
            total_ms INTEGER,
            user_message_len INTEGER,
            response_len INTEGER,
            tts_text_len INTEGER,
            tts_provider TEXT,
            tts_success INTEGER DEFAULT 1,
            tts_error TEXT,
            tool_count INTEGER DEFAULT 0,
            fallback_used INTEGER DEFAULT 0,
            error TEXT,
            created_at TEXT
        )
    ''')
    conn.commit()
    conn.close()

def get_current_month():
    return datetime.now().strftime('%Y-%m')

def get_user_usage(user_id):
    """Get user's message count for current month"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    current_month = get_current_month()

    c.execute('SELECT message_count, month FROM usage WHERE user_id = ?', (user_id,))
    row = c.fetchone()
    conn.close()

    if row:
        count, month = row
        # Reset if new month
        if month != current_month:
            return 0
        return count
    return 0

def increment_usage(user_id):
    """Increment user's message count"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    current_month = get_current_month()
    now = datetime.now().isoformat()

    c.execute('SELECT month FROM usage WHERE user_id = ?', (user_id,))
    row = c.fetchone()

    if row:
        if row[0] != current_month:
            # New month, reset count
            c.execute('UPDATE usage SET message_count = 1, month = ?, updated_at = ? WHERE user_id = ?',
                     (current_month, now, user_id))
        else:
            c.execute('UPDATE usage SET message_count = message_count + 1, updated_at = ? WHERE user_id = ?',
                     (now, user_id))
    else:
        c.execute('INSERT INTO usage (user_id, message_count, month, updated_at) VALUES (?, 1, ?, ?)',
                 (user_id, current_month, now))

    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Face recognition setup
KNOWN_FACES_DIR = Path(__file__).parent / "known_faces"
KNOWN_FACES_DIR.mkdir(exist_ok=True)
FACE_OWNERS_FILE = Path(__file__).parent / "face_owners.json"

def load_face_owners():
    """Load face ownership data (which Clerk user owns which face name)"""
    if FACE_OWNERS_FILE.exists():
        with open(FACE_OWNERS_FILE) as f:
            return json.load(f)
    return {}

def save_face_owners(owners):
    """Save face ownership data"""
    with open(FACE_OWNERS_FILE, 'w') as f:
        json.dump(owners, f, indent=2)

# Lazy load DeepFace (it's heavy)
_deepface = None
def get_deepface():
    global _deepface
    if _deepface is None:
        from deepface import DeepFace
        _deepface = DeepFace
    return _deepface

# Current identified person (persists during session)
current_identity = None

@app.route('/')
def serve_index():
    """Serve index.html with injected runtime config.

    Set AGENT_SERVER_URL in .env to point the frontend at a different backend.
    Defaults to window.location.origin (correct for same-origin deploys).
    """
    import pathlib
    from flask import Response as _Response
    html = pathlib.Path('index.html').read_text()

    server_url = os.environ.get('AGENT_SERVER_URL', '').strip().rstrip('/')
    if server_url:
        config_block = f'<script>window.AGENT_CONFIG={{serverUrl:"{server_url}"}};</script>'
    else:
        config_block = '<script>window.AGENT_CONFIG={serverUrl:window.location.origin};</script>'

    html = html.replace('</head>', f'  {config_block}\n</head>', 1)
    resp = _Response(html, mimetype='text/html')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@app.route('/greetings.md')
def serve_greetings():
    return send_file('greetings.md', mimetype='text/plain')

# /known_faces/<name>/<filename> — extracted to routes/static_files.py (P2-T8)

# Configure Gemini
genai.configure(api_key=os.getenv('GEMINI_API_KEY'))

# Store the latest frame from the client
latest_frame = None

@app.route('/api/health', methods=['GET'])
@app.route('/api/health-light', methods=['GET'])
def health():
    """Legacy health check endpoint (kept for backward compatibility)."""
    return jsonify({"status": "ok", "service": "openvoiceui"})

# --- Liveness + Readiness probes (ADR-006) ---
from health import health_checker as _health_checker

@app.route('/health/live', methods=['GET'])
def health_live():
    """Liveness probe — always 200 if process is running. Use this for watchdog."""
    result = _health_checker.liveness()
    return jsonify({
        "healthy": result.healthy,
        "message": result.message,
        "details": result.details,
    }), 200

@app.route('/health/ready', methods=['GET'])
def health_ready():
    """Readiness probe — 200 only when Gateway + TTS are available."""
    result = _health_checker.readiness()
    status_code = 200 if result.healthy else 503
    return jsonify({
        "healthy": result.healthy,
        "message": result.message,
        "details": result.details,
    }), status_code

@app.route('/api/memory-status', methods=['GET'])
def memory_status():
    """Memory status for watchdog monitoring"""
    import resource
    rusage = resource.getrusage(resource.RUSAGE_SELF)
    current_mb = rusage.ru_maxrss / 1024  # ru_maxrss is in KB on Linux
    return jsonify({"process": {"current_mb": round(current_mb, 1)}})

@app.route('/api/session', methods=['GET'])
def session_info():
    """Get current voice session key and stats."""
    return jsonify({
        "sessionKey": get_voice_session_key(),
        "consecutiveEmpty": _consecutive_empty_responses
    })

@app.route('/api/session/reset', methods=['POST'])
def session_reset():
    """Reset conversation context.

    Body (JSON, optional):
      { "mode": "soft" }  — increment session key only (default)
      { "mode": "hard" }  — increment session key + clear in-memory histories
    """
    data = request.get_json(silent=True) or {}
    mode = data.get('mode', 'soft')
    if mode not in ('soft', 'hard'):
        return jsonify({"error": f"Invalid mode '{mode}'. Use 'soft' or 'hard'."}), 400

    old_key = get_voice_session_key()
    new_key = bump_voice_session()

    cleared_sessions = 0
    if mode == 'hard':
        cleared_sessions = len(conversation_histories)
        conversation_histories.clear()
        logger.info(f"### HARD RESET: cleared {cleared_sessions} in-memory session(s), new key={new_key}")

    # Fire-and-forget pre-warm: send a silent ping to Z.AI on the new session key
    # so the cache is warm before the user's first real message.
    def _prewarm():
        try:
            from routes.conversation import get_voice_session_key as _gsk
            import threading as _threading
            _key = _gsk()
            gateway_connection.stream_to_queue(
                __import__('queue').Queue(),
                '[SYSTEM: session pre-warm, reply with exactly: ok]',
                _key,
                [],
            )
            logger.info(f'### PRE-WARM complete for {_key}')
        except Exception as e:
            logger.warning(f'### PRE-WARM failed: {e}')
    threading.Thread(target=_prewarm, daemon=True).start()

    response = {
        "old": old_key,
        "new": new_key,
        "mode": mode,
        "message": f"Session reset ({mode}). Pre-warming new session...",
    }
    if mode == 'hard':
        response["cleared_sessions"] = cleared_sessions
    return jsonify(response)


@app.route('/api/diagnostics', methods=['GET'])
def diagnostics():
    """Diagnostic dashboard — current state, recent timing metrics, error counts.

    Use this to immediately see what profile is active, how fast responses are,
    and whether TTS is failing. Prevents going in circles across sessions.
    """
    import resource

    # Current server state
    uptime_seconds = int(time.time() - SERVER_START_TIME)
    uptime_h = uptime_seconds // 3600
    uptime_m = (uptime_seconds % 3600) // 60
    rusage = resource.getrusage(resource.RUSAGE_SELF)
    memory_mb = round(rusage.ru_maxrss / 1024, 1)

    # Determine active profile by reading the toggle
    # Toggle is at "if False:" (gateway disabled) / "if True:" (gateway enabled)
    active_profile = "flash-direct"  # Profile A: direct Z.AI glm-4.5-flash

    state = {
        "server": {
            "uptime": f"{uptime_h}h {uptime_m}m",
            "uptime_seconds": uptime_seconds,
            "memory_mb": memory_mb,
            "pid": os.getpid(),
            "started_at": datetime.fromtimestamp(SERVER_START_TIME).isoformat(),
        },
        "profile": {
            "active": active_profile,
            "model": "zai/glm-4.7-flash" if active_profile == "gateway" else "glm-4.5-flash",
            "session_key": "voice-main-2",
            "gateway_url": os.getenv('CLAWDBOT_GATEWAY_URL', 'ws://127.0.0.1:18791'),
            "tts_provider": "groq-orpheus" if os.getenv('USE_GROQ_TTS', 'false').lower() == 'true' else "supertonic",
        },
    }

    # Recent conversation metrics from SQLite
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()

        # Last 10 conversations
        c.execute('''SELECT profile, model, handshake_ms, llm_inference_ms,
                            tts_generation_ms, total_ms, user_message_len,
                            response_len, tts_text_len, tts_provider, tts_success,
                            tts_error, tool_count, fallback_used, error, created_at
                     FROM conversation_metrics
                     ORDER BY id DESC LIMIT 10''')
        recent = [dict(row) for row in c.fetchall()]

        # Aggregate stats (last hour)
        c.execute('''SELECT
                        COUNT(*) as total_conversations,
                        AVG(total_ms) as avg_total_ms,
                        AVG(llm_inference_ms) as avg_llm_ms,
                        AVG(tts_generation_ms) as avg_tts_ms,
                        AVG(handshake_ms) as avg_handshake_ms,
                        SUM(CASE WHEN tts_success = 0 THEN 1 ELSE 0 END) as tts_failures,
                        SUM(CASE WHEN fallback_used = 1 THEN 1 ELSE 0 END) as flash_fallbacks,
                        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors,
                        MAX(total_ms) as max_total_ms,
                        MIN(total_ms) as min_total_ms
                     FROM conversation_metrics
                     WHERE created_at > datetime('now', '-1 hour')''')
        stats_row = c.fetchone()
        stats = dict(stats_row) if stats_row else {}

        # Round averages
        for key in ['avg_total_ms', 'avg_llm_ms', 'avg_tts_ms', 'avg_handshake_ms']:
            if stats.get(key) is not None:
                stats[key] = round(stats[key])

        conn.close()

        state["recent_conversations"] = recent
        state["last_hour_stats"] = stats

    except Exception as e:
        state["metrics_error"] = str(e)

    return jsonify(state)

@app.route('/api/hume/token', methods=['GET'])
def get_hume_token():
    """
    Get Hume access token for EVI WebSocket connection.
    The client needs this to connect to Hume's EVI API.
    Returns 403 if credentials are not configured (graceful degradation).
    """
    api_key = os.getenv('HUME_API_KEY')
    secret_key = os.getenv('HUME_SECRET_KEY')

    if not api_key or not secret_key:
        # Return 403 to indicate Hume is not available (not an error, just not configured)
        return jsonify({
            "error": "Hume API credentials not configured",
            "available": False
        }), 403

    try:
        # Hume uses OAuth2 client credentials flow
        import base64
        credentials = f"{api_key}:{secret_key}"
        encoded = base64.b64encode(credentials.encode()).decode()

        response = requests.post(
            'https://api.hume.ai/oauth2-cc/token',
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': f'Basic {encoded}'
            },
            data={'grant_type': 'client_credentials'}
        )

        if response.status_code != 200:
            print(f"Hume token error: {response.status_code} - {response.text}")
            return jsonify({
                "error": "Failed to get Hume access token",
                "available": False
            }), 500

        token_data = response.json()
        return jsonify({
            "access_token": token_data.get('access_token'),
            "expires_in": token_data.get('expires_in', 3600),
            "config_id": os.getenv('HUME_CONFIG_ID'),
            "available": True
        })
    except Exception as e:
        print(f"Hume token error: {e}")
        return jsonify({
            "error": str(e),
            "available": False
        }), 500

@app.route('/api/frame', methods=['POST'])
def receive_frame():
    """Receive a frame from the client's camera"""
    global latest_frame

    data = request.get_json()
    if not data or 'image' not in data:
        return jsonify({"error": "No image data provided"}), 400

    latest_frame = data['image']  # base64 encoded image
    return jsonify({"status": "frame received"})

@app.route('/api/vision', methods=['GET', 'POST'])
def vision():
    """
    Hume tool endpoint - analyze what the camera sees
    Called when user says trigger words like "look", "see", "what is this"
    """
    global latest_frame

    if not latest_frame:
        return jsonify({
            "response": "I can't see anything right now. The camera doesn't seem to be enabled. Tell the human to click the camera button if they want me to see."
        })

    try:
        # Decode base64 image
        image_data = base64.b64decode(latest_frame.split(',')[1] if ',' in latest_frame else latest_frame)

        # Use Gemini Vision to analyze the image
        model = genai.GenerativeModel('gemini-2.0-flash')

        # Create the image part for Gemini
        image_part = {
            "mime_type": "image/jpeg",
            "data": image_data
        }

        prompt = """You are a helpful AI assistant. Describe what you see in this image in 1-2 sentences.
Be clear and concise.
Keep it brief but make sure to actually describe what's in the image.
Don't mention that you're an AI or that this is an image - just describe what you "see" as if you're looking through your camera."""

        response = model.generate_content([prompt, image_part])

        description = response.text.strip()

        return jsonify({
            "response": description
        })

    except Exception as e:
        print(f"Vision error: {e}")
        return jsonify({
            "response": "Ugh, my vision circuits are acting up. I can't process what I'm seeing right now. Typical."
        })


@app.route('/api/stt/groq', methods=['POST'])
def groq_stt():
    """
    Groq Whisper Large v3 Turbo - Speech to Text
    Accepts audio file and returns transcription
    """
    logger = logging.getLogger(__name__)

    try:
        # Check if audio file is in request
        if 'audio' not in request.files:
            return jsonify({"error": "No audio file provided"}), 400

        audio_file = request.files['audio']

        # Get Groq client
        groq = _tts_get_groq_client()
        if not groq:
            return jsonify({"error": "Groq client not available"}), 500

        logger.info("Transcribing audio with Groq Whisper Large v3 Turbo")

        # Groq expects file as tuple: (filename, file_bytes, content_type)
        audio_bytes = audio_file.read()
        audio_tuple = (audio_file.filename or "audio.webm", audio_bytes, audio_file.content_type or "audio/webm")

        # Call Groq Whisper API
        transcription = groq.audio.transcriptions.create(
            file=audio_tuple,
            model="whisper-large-v3-turbo",
            response_format="json",
            language="en"
        )

        transcript = transcription.text
        logger.info(f"Whisper transcription: {transcript}")

        return jsonify({
            "transcript": transcript,
            "success": True
        })

    except Exception as e:
        logger.error(f"Groq Whisper error: {e}")
        return jsonify({"error": f"STT failed: {str(e)}"}), 500

@app.route('/api/stt/local', methods=['POST'])
def local_stt():
    """Local Faster-Whisper STT with Silero VAD - eliminates hallucinations on silence"""
    logger = logging.getLogger(__name__)

    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400

        audio_file = request.files['audio']
        audio_bytes = audio_file.read()

        # Save to temp file - faster-whisper needs a file path
        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            # Convert webm to wav using ffmpeg (faster-whisper handles wav better)
            wav_path = tmp_path.replace('.webm', '.wav')
            result = subprocess.run(
                ['ffmpeg', '-y', '-i', tmp_path, '-ar', '16000', '-ac', '1', '-f', 'wav', wav_path],
                capture_output=True, timeout=10
            )

            if result.returncode != 0:
                logger.error(f'FFmpeg conversion failed: {result.stderr.decode()}')
                # Try transcribing the original file directly
                wav_path = tmp_path

            # Transcribe with Silero VAD filtering
            segments, info = get_whisper_model().transcribe(
                wav_path,
                language='en',
                vad_filter=True,
                vad_parameters={'min_silence_duration_ms': 500, 'threshold': 0.5}
            )

            transcript = ' '.join(seg.text for seg in segments).strip()
            logger.info(f'Local Whisper transcription: "{transcript}" (duration: {info.duration:.1f}s)')

            return jsonify({
                'transcript': transcript,
                'success': True
            })
        finally:
            # Clean up temp files
            for f in [tmp_path, tmp_path.replace('.webm', '.wav')]:
                try:
                    os.unlink(f)
                except OSError:
                    pass

    except Exception as e:
        logger.error(f'Local Whisper error: {e}')
        return jsonify({'error': f'STT failed: {str(e)}'}), 500

@app.route('/api/search/brave', methods=['GET'])
def brave_search():
    """
    Brave Search API - Web search with AI summaries
    GET /api/search/brave?q=search+query
    """
    logger = logging.getLogger(__name__)

    try:
        query = request.args.get('q', '').strip()
        if not query:
            return jsonify({"error": "No query provided"}), 400

        brave_api_key = os.getenv('BRAVE_API_KEY')
        if not brave_api_key:
            return jsonify({"error": "Brave API key not configured"}), 500

        logger.info(f"Brave Search: {query}")

        # Call Brave Search API
        headers = {
            'Accept': 'application/json',
            'X-Subscription-Token': brave_api_key
        }

        params = {
            'q': query,
            'count': 10,  # Number of results
            'search_lang': 'en',
            'freshness': 'pw'  # Past week for fresher results
        }

        response = requests.get(
            'https://api.search.brave.com/res/v1/web/search',
            headers=headers,
            params=params,
            timeout=10
        )

        if response.status_code != 200:
            logger.error(f"Brave API error: {response.status_code} - {response.text}")
            return jsonify({"error": f"Brave API error: {response.status_code}"}), response.status_code

        data = response.json()

        # Extract useful results
        results = []
        if 'web' in data and 'results' in data['web']:
            for result in data['web']['results'][:5]:  # Top 5 results
                results.append({
                    'title': result.get('title', ''),
                    'url': result.get('url', ''),
                    'description': result.get('description', '')
                })

        logger.info(f"Found {len(results)} results")

        return jsonify({
            'query': query,
            'results': results,
            'success': True
        })

    except Exception as e:
        logger.error(f"Brave Search error: {e}")
        return jsonify({"error": f"Search failed: {str(e)}"}), 500







# ===== FACE RECOGNITION ENDPOINTS =====

@app.route('/api/identify', methods=['POST'])
def identify_face():
    """
    Identify who is in the camera frame using DeepFace
    Returns the name of the person or 'unknown'
    """
    global current_identity

    data = request.get_json()
    if not data or 'image' not in data:
        return jsonify({"error": "No image data provided"}), 400

    try:
        # Decode base64 image
        image_data = data['image']
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        image_bytes = base64.b64decode(image_data)

        # Check if we have any known faces
        known_people = [d.name for d in KNOWN_FACES_DIR.iterdir() if d.is_dir() and any(d.iterdir())]
        if not known_people:
            current_identity = {"name": "unknown", "confidence": 0, "message": "No known faces in database"}
            return jsonify(current_identity)

        # Save temp file for DeepFace
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
            tmp.write(image_bytes)
            tmp_path = tmp.name

        try:
            DeepFace = get_deepface()

            # Search for face in known_faces database
            results = DeepFace.find(
                img_path=tmp_path,
                db_path=str(KNOWN_FACES_DIR),
                model_name='SFace',
                enforce_detection=False,
                silent=True
            )

            # Results is a list of DataFrames (one per face detected)
            if results and len(results) > 0 and len(results[0]) > 0:
                df = results[0]
                # Get best match (lowest distance)
                best_match = df.iloc[0]
                identity_path = best_match['identity']
                distance = best_match['distance']

                # Extract person name from path (known_faces/Mike/photo.jpg -> Mike)
                person_name = Path(identity_path).parent.name

                # SFace distance threshold is typically 0.5
                confidence = max(0, (1 - distance / 0.7)) * 100

                if distance < 0.5:
                    current_identity = {
                        "name": person_name,
                        "confidence": round(confidence, 1),
                        "message": f"Identified as {person_name}"
                    }
                else:
                    current_identity = {
                        "name": "unknown",
                        "confidence": round(confidence, 1),
                        "message": "Face detected but not recognized"
                    }
            else:
                current_identity = {
                    "name": "unknown",
                    "confidence": 0,
                    "message": "No face detected in frame"
                }

        finally:
            os.unlink(tmp_path)

        print(f"Face identification: {current_identity}")
        return jsonify(current_identity)

    except Exception as e:
        print(f"Face identification error: {e}")
        current_identity = {"name": "unknown", "confidence": 0, "message": str(e)}
        return jsonify(current_identity)

@app.route('/api/identity', methods=['GET'])
def get_identity():
    """Get the currently identified person - used by Hume identify_person tool"""
    global current_identity
    if current_identity and current_identity.get('name') and current_identity['name'] != 'unknown':
        name = current_identity['name']
        confidence = current_identity.get('confidence', 0)
        # Give Pi-Guy a response to speak
        return jsonify({
            **current_identity,
            "response": f"I can see you're {name}. I recognize your face with {confidence:.0f}% confidence."
        })
    elif current_identity:
        return jsonify({
            **current_identity,
            "response": "I can see a face but I don't recognize you. You're not in my database. Maybe you should add your face so I can remember you."
        })
    return jsonify({
        "name": "unknown",
        "confidence": 0,
        "message": "No identification performed yet",
        "response": "I can't see anyone right now. Is the camera even on? Turn it on if you want me to see who you are."
    })

@app.route('/api/faces', methods=['GET'])
def list_faces():
    """List all known faces in the database"""
    faces = {}
    owners = load_face_owners()

    for person_dir in KNOWN_FACES_DIR.iterdir():
        if person_dir.is_dir():
            images = [f.name for f in person_dir.iterdir() if f.suffix.lower() in ['.jpg', '.jpeg', '.png']]
            if images:
                faces[person_dir.name] = {
                    "photos": images,
                    "photo_count": len(images),
                    "owner_id": owners.get(person_dir.name)
                }
    return jsonify(faces)

@app.route('/api/faces/<name>', methods=['POST'])
def add_face(name):
    """
    Add a new face image for a person
    Expects base64 image and optional user_id in JSON body
    """
    data = request.get_json()
    if not data or 'image' not in data:
        return jsonify({"error": "No image data provided"}), 400

    user_id = data.get('user_id')  # Clerk user ID

    try:
        # Check ownership - only owner can add photos (or new name)
        owners = load_face_owners()
        if name in owners and owners[name] != user_id and user_id:
            return jsonify({"error": f"'{name}' is already registered by another user"}), 403

        # Create person directory if needed
        person_dir = KNOWN_FACES_DIR / name
        person_dir.mkdir(exist_ok=True)

        # Track ownership if user_id provided
        if user_id and name not in owners:
            owners[name] = user_id
            save_face_owners(owners)

        # Count existing images
        existing = len(list(person_dir.glob('*.jpg')))

        # Decode and save image
        image_data = data['image']
        if ',' in image_data:
            image_data = image_data.split(',')[1]
        image_bytes = base64.b64decode(image_data)

        image_path = person_dir / f"{name}_{existing + 1}.jpg"
        with open(image_path, 'wb') as f:
            f.write(image_bytes)

        # Clear DeepFace cache so it re-indexes
        cache_file = KNOWN_FACES_DIR / "representations_vgg_face.pkl"
        if cache_file.exists():
            cache_file.unlink()

        return jsonify({
            "status": "success",
            "message": f"Added face image for {name}",
            "path": str(image_path),
            "photo_count": existing + 1
        })

    except Exception as e:
        print(f"Add face error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/faces/<name>', methods=['DELETE'])
def remove_face(name):
    """Remove all face images for a person (must be owner or admin)"""
    data = request.get_json() or {}
    user_id = data.get('user_id')

    owners = load_face_owners()

    # Check ownership (allow if owner, or if Mike's unlimited user, or if no owner set)
    if name in owners and owners[name] != user_id:
        if user_id not in UNLIMITED_USERS:
            return jsonify({"error": "You can only delete your own face"}), 403

    person_dir = KNOWN_FACES_DIR / name
    if person_dir.exists():
        shutil.rmtree(person_dir)

        # Remove from owners
        if name in owners:
            del owners[name]
            save_face_owners(owners)

        # Clear DeepFace cache
        cache_file = KNOWN_FACES_DIR / "representations_vgg_face.pkl"
        if cache_file.exists():
            cache_file.unlink()

        return jsonify({"status": "success", "message": f"Removed {name} from database"})
    return jsonify({"error": f"{name} not found"}), 404

@app.route('/api/faces/<name>/photo/<filename>', methods=['DELETE'])
def remove_photo(name, filename):
    """Remove a single photo from a person's face set"""
    data = request.get_json() or {}
    user_id = data.get('user_id')

    owners = load_face_owners()

    # Check ownership
    if name in owners and owners[name] != user_id:
        if user_id not in UNLIMITED_USERS:
            return jsonify({"error": "You can only delete your own photos"}), 403

    photo_path = KNOWN_FACES_DIR / name / filename
    if photo_path.exists():
        photo_path.unlink()

        # Clear DeepFace cache
        cache_file = KNOWN_FACES_DIR / "representations_vgg_face.pkl"
        if cache_file.exists():
            cache_file.unlink()

        # Check if any photos left, if not remove the person entirely
        person_dir = KNOWN_FACES_DIR / name
        remaining = list(person_dir.glob('*.jpg')) + list(person_dir.glob('*.jpeg')) + list(person_dir.glob('*.png'))
        if not remaining:
            shutil.rmtree(person_dir)
            if name in owners:
                del owners[name]
                save_face_owners(owners)

        return jsonify({"status": "success", "message": f"Removed photo {filename}"})
    return jsonify({"error": "Photo not found"}), 404

# ===== USER USAGE ENDPOINTS =====

@app.route('/api/usage/<user_id>', methods=['GET'])
def check_usage(user_id):
    """Check user's current usage and remaining allowance"""
    # Unlimited users bypass limits
    if user_id in UNLIMITED_USERS:
        return jsonify({
            "user_id": user_id,
            "used": get_user_usage(user_id),
            "limit": -1,
            "remaining": -1,
            "allowed": True,
            "unlimited": True
        })

    count = get_user_usage(user_id)
    return jsonify({
        "user_id": user_id,
        "used": count,
        "limit": MONTHLY_LIMIT,
        "remaining": max(0, MONTHLY_LIMIT - count),
        "allowed": count < MONTHLY_LIMIT
    })

@app.route('/api/usage/<user_id>/increment', methods=['POST'])
def track_usage(user_id):
    """Increment user's usage count (called when agent responds)"""
    # Unlimited users still get tracked but never blocked
    if user_id in UNLIMITED_USERS:
        increment_usage(user_id)
        return jsonify({
            "user_id": user_id,
            "used": get_user_usage(user_id),
            "limit": -1,
            "remaining": -1,
            "unlimited": True
        })

    count = get_user_usage(user_id)

    if count >= MONTHLY_LIMIT:
        return jsonify({
            "error": "Monthly limit reached",
            "used": count,
            "limit": MONTHLY_LIMIT
        }), 429

    increment_usage(user_id)
    new_count = count + 1

    return jsonify({
        "user_id": user_id,
        "used": new_count,
        "limit": MONTHLY_LIMIT,
        "remaining": max(0, MONTHLY_LIMIT - new_count)
    })

# ===== SERVER STATUS ENDPOINT =====

@app.route('/api/server-status', methods=['GET'])
def server_status():
    """
    Get current server status - CPU, memory, disk, running processes
    Hume tool endpoint for Pi-Guy to check on his server
    """
    try:
        # System info
        cpu_percent = psutil.cpu_percent(interval=0.5)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        boot_time = datetime.fromtimestamp(psutil.boot_time())
        uptime = datetime.now() - boot_time

        # Get top processes by CPU
        processes = []
        for proc in sorted(psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']),
                          key=lambda p: p.info.get('cpu_percent', 0) or 0, reverse=True)[:10]:
            try:
                info = proc.info
                if info['cpu_percent'] and info['cpu_percent'] > 0:
                    processes.append({
                        'name': info['name'],
                        'cpu': round(info['cpu_percent'], 1),
                        'memory': round(info['memory_percent'], 1) if info['memory_percent'] else 0
                    })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        # Check if key services are running
        services = {
            'openvoiceui': False,
            'nginx': False,
            'python': False
        }
        for proc in psutil.process_iter(['name', 'cmdline']):
            try:
                name = proc.info['name'].lower()
                cmdline = ' '.join(proc.info['cmdline'] or []).lower()
                if 'nginx' in name:
                    services['nginx'] = True
                if 'python' in name and 'server.py' in cmdline:
                    services['openvoiceui'] = True
                if 'python' in name:
                    services['python'] = True
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        # Format uptime
        days = uptime.days
        hours, remainder = divmod(uptime.seconds, 3600)
        minutes, _ = divmod(remainder, 60)
        uptime_str = f"{days}d {hours}h {minutes}m" if days else f"{hours}h {minutes}m"

        disk_used_gb = round(disk.used / (1024**3), 1)
        disk_total_gb = round(disk.total / (1024**3), 1)
        disk_free_gb = round(disk.free / (1024**3), 1)

        status = {
            'cpu_percent': cpu_percent,
            'memory_used_percent': round(memory.percent, 1),
            'memory_used_gb': round(memory.used / (1024**3), 1),
            'memory_total_gb': round(memory.total / (1024**3), 1),
            'disk_used_percent': round(disk.percent, 1),
            'disk_used_gb': disk_used_gb,
            'disk_total_gb': disk_total_gb,
            'disk_free_gb': disk_free_gb,
            'uptime': uptime_str,
            'top_processes': processes[:5],
            'services': services
        }

        # Generate a Pi-Guy style summary with actual numbers
        summary_parts = []
        summary_parts.append(f"CPU at {cpu_percent}%")
        summary_parts.append(f"memory {memory.percent:.0f}% used ({round(memory.used / (1024**3), 1)}GB of {round(memory.total / (1024**3), 1)}GB)")
        summary_parts.append(f"disk {disk.percent:.0f}% full ({disk_used_gb}GB used, {disk_free_gb}GB free of {disk_total_gb}GB)")
        summary_parts.append(f"been up for {uptime_str}")

        if processes:
            top_proc = processes[0]
            summary_parts.append(f"top process is {top_proc['name']} at {top_proc['cpu']}% CPU")

        status['summary'] = f"Server status: {', '.join(summary_parts)}."

        return jsonify(status)

    except Exception as e:
        print(f"Server status error: {e}")
        return jsonify({
            "error": str(e),
            "summary": "I tried to check the server but something went wrong. Typical."
        }), 500


# ===== TODO LIST ENDPOINTS =====

def init_todos_table():
    """Initialize the todos table"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            task TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            created_at TEXT,
            completed_at TEXT
        )
    ''')
    conn.commit()
    conn.close()

# Initialize todos table
init_todos_table()

def get_user_id_from_request():
    """
    Get user ID from request params, or fall back to currently identified face.
    This allows the todo list to work with face recognition - if Pi-Guy knows who you are,
    he can manage your todos without needing a Clerk login.
    """
    global current_identity

    # First try explicit user_id from request
    user_id = request.args.get('user_id')
    if user_id and user_id != 'undefined' and user_id != 'null':
        return user_id

    # Fall back to identified face name
    if current_identity and current_identity.get('name') and current_identity['name'] != 'unknown':
        return current_identity['name']

    return None

@app.route('/api/todos', methods=['GET'])
def handle_todos():
    """
    All-in-one todo endpoint for Hume (uses GET for webhooks)
    Query params:
      - user_id (optional - falls back to identified face)
      - task (if provided, ADDS a new todo)
      - task_text (if provided, COMPLETES a matching todo)
      - show_completed (true to include completed items in list)
    """
    user_id = get_user_id_from_request()
    task = request.args.get('task')
    task_text = request.args.get('task_text')
    show_completed = request.args.get('show_completed', 'false').lower() == 'true'

    if not user_id:
        return jsonify({"error": "user_id required", "response": "I don't know who you are. Turn on the camera so I can see you, or log in."})

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    now = datetime.now().isoformat()

    # If task is provided, ADD a new todo
    if task:
        c.execute('INSERT INTO todos (user_id, task, created_at) VALUES (?, ?, ?)', (user_id, task, now))
        conn.commit()
        conn.close()
        return jsonify({
            "action": "added",
            "task": task,
            "response": f"Fine, I added '{task}' to your list. Try not to forget about it like you do everything else."
        })

    # If task_text is provided, COMPLETE a matching todo
    if task_text:
        c.execute('SELECT id, task FROM todos WHERE user_id = ? AND completed = 0', (user_id,))
        rows = c.fetchall()
        matched = None
        task_text_lower = task_text.lower()
        for row in rows:
            if task_text_lower in row[1].lower():
                matched = row
                break
        if matched:
            c.execute('UPDATE todos SET completed = 1, completed_at = ? WHERE id = ?', (now, matched[0]))
            conn.commit()
            conn.close()
            return jsonify({
                "action": "completed",
                "task": matched[1],
                "response": f"Done! '{matched[1]}' is checked off. One less thing for you to forget about."
            })
        else:
            conn.close()
            return jsonify({
                "error": "not found",
                "response": f"I couldn't find a todo matching '{task_text}'. Are you sure you added it?"
            })

    # Otherwise, LIST todos
    if show_completed:
        c.execute('SELECT id, task, completed, created_at, completed_at FROM todos WHERE user_id = ? ORDER BY completed ASC, created_at DESC', (user_id,))
    else:
        c.execute('SELECT id, task, completed, created_at, completed_at FROM todos WHERE user_id = ? AND completed = 0 ORDER BY created_at DESC', (user_id,))

    rows = c.fetchall()
    conn.close()

    todos = [{"id": r[0], "task": r[1], "completed": bool(r[2]), "created_at": r[3], "completed_at": r[4]} for r in rows]

    # Generate Pi-Guy style response
    if not todos:
        response = "Your todo list is empty. Either you're incredibly productive or you've been slacking and haven't added anything yet."
    else:
        incomplete = [t for t in todos if not t['completed']]
        if len(incomplete) == 0:
            response = f"All {len(todos)} todos are done! Look at you, actually being productive for once."
        else:
            task_list = ", ".join([f"'{t['task']}'" for t in incomplete[:5]])
            if len(incomplete) > 5:
                task_list += f" and {len(incomplete) - 5} more"
            response = f"You have {len(incomplete)} thing{'s' if len(incomplete) != 1 else ''} to do: {task_list}."

    return jsonify({"todos": todos, "count": len(todos), "response": response, "user": user_id})

@app.route('/api/todos', methods=['POST'])
def add_todo():
    """
    Add a new todo - Hume tool endpoint
    Body: { "user_id": "...", "task": "..." }
    Falls back to identified face if no user_id provided
    """
    data = request.get_json() or {}
    user_id = data.get('user_id') or get_user_id_from_request()
    task = data.get('task') or request.args.get('task')

    if not user_id:
        return jsonify({"error": "user_id required", "response": "I don't know who you are. Turn on the camera so I can see you, or log in."})
    if not task:
        return jsonify({"error": "task required", "response": "What do you want me to add? You didn't tell me the task."})

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    now = datetime.now().isoformat()
    c.execute('INSERT INTO todos (user_id, task, created_at) VALUES (?, ?, ?)', (user_id, task, now))
    todo_id = c.lastrowid
    conn.commit()
    conn.close()

    return jsonify({
        "id": todo_id,
        "task": task,
        "response": f"Fine, I added '{task}' to your list. Try not to forget about it like you do everything else."
    })

@app.route('/api/todos/complete', methods=['POST'])
def complete_todo():
    """
    Mark a todo as complete - Hume tool endpoint
    Body: { "user_id": "...", "task_id": N } or { "user_id": "...", "task_text": "..." }
    Falls back to identified face if no user_id provided
    """
    data = request.get_json() or {}
    user_id = data.get('user_id') or get_user_id_from_request()
    task_id = data.get('task_id') or request.args.get('task_id')
    task_text = data.get('task_text') or request.args.get('task_text')

    if not user_id:
        return jsonify({"error": "user_id required", "response": "I don't know who you are. Turn on the camera so I can see you, or log in."})

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    now = datetime.now().isoformat()

    if task_id:
        c.execute('UPDATE todos SET completed = 1, completed_at = ? WHERE id = ? AND user_id = ?', (now, task_id, user_id))
    elif task_text:
        # Fuzzy match - find todo containing the text
        c.execute('SELECT id, task FROM todos WHERE user_id = ? AND completed = 0', (user_id,))
        rows = c.fetchall()
        matched = None
        task_text_lower = task_text.lower()
        for row in rows:
            if task_text_lower in row[1].lower():
                matched = row
                break
        if matched:
            c.execute('UPDATE todos SET completed = 1, completed_at = ? WHERE id = ?', (now, matched[0]))
            task_text = matched[1]
        else:
            conn.close()
            return jsonify({"error": "task not found", "response": f"I couldn't find a todo matching '{task_text}'. Are you sure you added it?"})
    else:
        conn.close()
        return jsonify({"error": "task_id or task_text required", "response": "Which task do you want to complete? Give me an ID or description."})

    conn.commit()
    affected = c.rowcount
    conn.close()

    if affected > 0:
        return jsonify({"completed": True, "response": f"Done! '{task_text}' is checked off. One less thing for you to forget about."})
    return jsonify({"completed": False, "response": "Couldn't find that task. Maybe you already did it, or maybe it never existed."})

@app.route('/api/todos/<int:todo_id>', methods=['DELETE'])
def delete_todo(todo_id):
    """Delete a todo (not just complete, actually remove it)"""
    data = request.get_json() or {}
    user_id = data.get('user_id') or request.args.get('user_id')

    if not user_id:
        return jsonify({"error": "user_id required"})

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('DELETE FROM todos WHERE id = ? AND user_id = ?', (todo_id, user_id))
    conn.commit()
    affected = c.rowcount
    conn.close()

    if affected > 0:
        return jsonify({"deleted": True, "response": "Poof! Gone. Like it never existed."})
    return jsonify({"deleted": False, "response": "That todo doesn't exist or isn't yours."})

# ===== WEB SEARCH ENDPOINT =====

@app.route('/api/search', methods=['GET', 'POST'])
def web_search():
    """
    Search the web using DuckDuckGo (free, no API key needed)
    Hume tool endpoint
    Query/Body: { "query": "search terms" }
    """
    if request.method == 'POST':
        data = request.get_json() or {}
        query = data.get('query')
    else:
        query = request.args.get('query')

    if not query:
        return jsonify({"error": "query required", "response": "Search for what? You didn't tell me what to look up."})

    try:
        # Use DuckDuckGo HTML search (no API key needed)
        import urllib.request
        import urllib.parse
        from html.parser import HTMLParser

        # Simple HTML parser to extract search results
        class DDGParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.results = []
                self.in_result = False
                self.current_result = {}
                self.capture_text = False
                self.current_text = ""

            def handle_starttag(self, tag, attrs):
                attrs_dict = dict(attrs)
                # Look for result links
                if tag == 'a' and attrs_dict.get('class', '') == 'result__a':
                    self.in_result = True
                    self.current_result = {'url': attrs_dict.get('href', ''), 'title': '', 'snippet': ''}
                    self.capture_text = True
                # Look for snippets
                elif tag == 'a' and attrs_dict.get('class', '') == 'result__snippet':
                    self.capture_text = True

            def handle_endtag(self, tag):
                if tag == 'a' and self.capture_text:
                    if self.in_result and not self.current_result.get('title'):
                        self.current_result['title'] = self.current_text.strip()
                    elif self.current_result.get('title') and not self.current_result.get('snippet'):
                        self.current_result['snippet'] = self.current_text.strip()
                        if self.current_result['title'] and self.current_result['url']:
                            self.results.append(self.current_result)
                        self.current_result = {}
                        self.in_result = False
                    self.capture_text = False
                    self.current_text = ""

            def handle_data(self, data):
                if self.capture_text:
                    self.current_text += data

        # Make request to DuckDuckGo
        encoded_query = urllib.parse.quote_plus(query)
        url = f"https://html.duckduckgo.com/html/?q={encoded_query}"

        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        })

        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8')

        parser = DDGParser()
        parser.feed(html)
        results = parser.results[:5]  # Top 5 results

        if not results:
            return jsonify({
                "query": query,
                "results": [],
                "response": f"I searched for '{query}' but didn't find anything useful. The internet has failed you."
            })

        # Generate summary
        summary_parts = [f"Here's what I found for '{query}':"]
        for i, r in enumerate(results[:3], 1):
            summary_parts.append(f"{i}. {r['title']}")

        return jsonify({
            "query": query,
            "results": results,
            "response": " ".join(summary_parts)
        })

    except Exception as e:
        print(f"Search error: {e}")
        return jsonify({
            "error": str(e),
            "response": f"My search circuits failed. Something went wrong looking up '{query}'. Typical internet."
        })

# ===== SERVER COMMANDS ENDPOINT =====

# Whitelist of allowed commands (moderate security)
ALLOWED_COMMANDS = {
    'git_status': {'cmd': ['git', 'status'], 'cwd': '/home/mike/Mike-AI/ai-eyes', 'desc': 'Check git status'},
    'git_log': {'cmd': ['git', 'log', '--oneline', '-10'], 'cwd': '/home/mike/Mike-AI/ai-eyes', 'desc': 'Recent commits'},
    'disk_usage': {'cmd': ['df', '-h', '/'], 'desc': 'Disk usage'},
    'memory': {'cmd': ['free', '-h'], 'desc': 'Memory usage'},
    'uptime': {'cmd': ['uptime'], 'desc': 'System uptime'},
    'date': {'cmd': ['date'], 'desc': 'Current date/time'},
    'whoami': {'cmd': ['whoami'], 'desc': 'Current user'},
    'list_files': {'cmd': ['ls', '-la', '/mnt/HC_Volume_103321268/websites/OpenVoiceUI'], 'desc': 'List project files'},
    'list_faces': {'cmd': ['ls', '-la', '/mnt/HC_Volume_103321268/websites/OpenVoiceUI/known_faces'], 'desc': 'List known faces'},
    'nginx_status': {'cmd': ['systemctl', 'status', 'nginx', '--no-pager'], 'desc': 'Nginx status'},
    'service_status': {'cmd': ['systemctl', 'status', 'agent-openvoice-ui', '--no-pager'], 'desc': 'OpenVoiceUI service status'},
    'network': {'cmd': ['ss', '-tuln'], 'desc': 'Network connections'},
    'processes': {'cmd': ['ps', 'aux', '--sort=-%cpu'], 'desc': 'Running processes'},
    'hostname': {'cmd': ['hostname'], 'desc': 'Server hostname'},
    'ip_address': {'cmd': ['hostname', '-I'], 'desc': 'Server IP addresses'},
}

@app.route('/api/command', methods=['GET', 'POST'])
def run_command():
    """
    Run a whitelisted server command - Hume tool endpoint
    Query/Body: { "command": "git_status" } - must be from whitelist
    Also accepts natural language and tries to match
    """
    if request.method == 'POST':
        data = request.get_json() or {}
        command = data.get('command')
    else:
        command = request.args.get('command')

    if not command:
        # Return list of available commands
        available = [{"name": k, "description": v['desc']} for k, v in ALLOWED_COMMANDS.items()]
        return jsonify({
            "available_commands": available,
            "response": "What command do you want me to run? Available: " + ", ".join(ALLOWED_COMMANDS.keys())
        })

    # Try to match command (exact or fuzzy)
    command_lower = command.lower().replace(' ', '_').replace('-', '_')
    matched_cmd = None

    # Exact match
    if command_lower in ALLOWED_COMMANDS:
        matched_cmd = command_lower
    else:
        # Fuzzy match - look for keywords
        keyword_map = {
            'git': 'git_status',
            'commit': 'git_log',
            'disk': 'disk_usage',
            'space': 'disk_usage',
            'memory': 'memory',
            'ram': 'memory',
            'time': 'date',
            'date': 'date',
            'files': 'list_files',
            'ls': 'list_files',
            'faces': 'list_faces',
            'nginx': 'nginx_status',
            'web': 'nginx_status',
            'service': 'service_status',
            'openvoiceui': 'service_status',
            'network': 'network',
            'ports': 'network',
            'process': 'processes',
            'cpu': 'processes',
            'running': 'processes',
            'host': 'hostname',
            'ip': 'ip_address',
            'address': 'ip_address',
            'uptime': 'uptime',
        }
        for keyword, cmd_name in keyword_map.items():
            if keyword in command_lower:
                matched_cmd = cmd_name
                break

    if not matched_cmd:
        return jsonify({
            "error": "command not allowed",
            "response": f"I can't run '{command}'. I only run safe commands. Try: {', '.join(list(ALLOWED_COMMANDS.keys())[:5])}..."
        })

    cmd_info = ALLOWED_COMMANDS[matched_cmd]

    try:
        result = subprocess.run(
            cmd_info['cmd'],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=cmd_info.get('cwd')
        )

        output = result.stdout.strip() or result.stderr.strip()

        # Truncate if too long
        if len(output) > 1500:
            output = output[:1500] + "\n... (truncated)"

        return jsonify({
            "command": matched_cmd,
            "description": cmd_info['desc'],
            "output": output,
            "return_code": result.returncode,
            "response": f"Ran '{cmd_info['desc']}'. {output[:200]}{'...' if len(output) > 200 else ''}"
        })

    except subprocess.TimeoutExpired:
        return jsonify({
            "error": "timeout",
            "response": f"The command '{matched_cmd}' took too long. Killed it after 30 seconds."
        })
    except Exception as e:
        print(f"Command error: {e}")
        return jsonify({
            "error": str(e),
            "response": f"Failed to run '{matched_cmd}'. Something broke: {str(e)}"
        })

@app.route('/api/commands', methods=['GET'])
def list_commands():
    """List all available commands"""
    available = [{"name": k, "description": v['desc']} for k, v in ALLOWED_COMMANDS.items()]
    return jsonify({
        "commands": available,
        "response": f"I can run {len(available)} different commands. Ask me to check git status, disk space, memory, processes, and more."
    })


# ===== PI-GUY NOTES/FILES SYSTEM =====

NOTES_DIR = Path(__file__).parent / "pi_notes"
NOTES_DIR.mkdir(exist_ok=True)

# Music directories managed by routes/music.py (P2-T4)

def sanitize_filename(name):
    """Sanitize filename to prevent path traversal"""
    # Remove any path separators and dangerous characters
    name = name.replace('/', '_').replace('\\', '_').replace('..', '_')
    # Only allow alphanumeric, underscore, hyphen, and dot
    safe_name = ''.join(c for c in name if c.isalnum() or c in '._-')
    # Ensure it ends with .md if no extension
    if not safe_name.endswith('.md'):
        safe_name += '.md'
    return safe_name[:100]  # Limit length

@app.route('/api/notes', methods=['GET'])
def handle_notes():
    """
    All-in-one notes endpoint for Hume (uses GET for webhooks)
    Query params:
      - action: 'list', 'read', 'write', 'append', 'delete'
      - filename: name of the file (for read/write/append/delete)
      - content: content to write/append (for write/append)
      - search: search term to find in notes (optional)
    """
    action = request.args.get('action', 'list')
    filename = request.args.get('filename', '')
    content = request.args.get('content', '')
    search = request.args.get('search', '')

    try:
        # LIST all notes
        if action == 'list':
            notes = []
            for f in NOTES_DIR.iterdir():
                if f.is_file() and f.suffix == '.md':
                    stat = f.stat()
                    notes.append({
                        'filename': f.name,
                        'size_bytes': stat.st_size,
                        'modified': datetime.fromtimestamp(stat.st_mtime).isoformat()
                    })
            notes.sort(key=lambda x: x['modified'], reverse=True)

            if not notes:
                return jsonify({
                    "notes": [],
                    "count": 0,
                    "response": "I don't have any notes yet. Tell me to write something down and I'll remember it."
                })

            note_list = ", ".join([n['filename'] for n in notes[:10]])
            return jsonify({
                "notes": notes,
                "count": len(notes),
                "response": f"I have {len(notes)} note{'s' if len(notes) != 1 else ''}: {note_list}"
            })

        # READ a note
        elif action == 'read':
            if not filename:
                return jsonify({"error": "filename required", "response": "Which note do you want me to read? Give me a filename."})

            safe_name = sanitize_filename(filename)
            note_path = NOTES_DIR / safe_name

            if not note_path.exists():
                # Try fuzzy match
                matches = [f for f in NOTES_DIR.iterdir() if filename.lower() in f.name.lower()]
                if matches:
                    note_path = matches[0]
                    safe_name = note_path.name
                else:
                    return jsonify({"error": "not found", "response": f"I don't have a note called '{filename}'. Use 'list notes' to see what I have."})

            content = note_path.read_text()
            return jsonify({
                "filename": safe_name,
                "content": content,
                "size_bytes": len(content),
                "response": f"Here's my note '{safe_name}':\n\n{content[:500]}{'...' if len(content) > 500 else ''}"
            })

        # WRITE a new note (overwrites if exists)
        elif action == 'write':
            if not filename:
                return jsonify({"error": "filename required", "response": "What should I call this note?"})
            if not content:
                return jsonify({"error": "content required", "response": "What do you want me to write in this note?"})

            safe_name = sanitize_filename(filename)
            note_path = NOTES_DIR / safe_name
            note_path.write_text(content)

            return jsonify({
                "filename": safe_name,
                "size_bytes": len(content),
                "response": f"Got it. I saved that to '{safe_name}'. I'll remember it."
            })

        # APPEND to an existing note
        elif action == 'append':
            if not filename:
                return jsonify({"error": "filename required", "response": "Which note should I add to?"})
            if not content:
                return jsonify({"error": "content required", "response": "What do you want me to add?"})

            safe_name = sanitize_filename(filename)
            note_path = NOTES_DIR / safe_name

            existing = note_path.read_text() if note_path.exists() else ""
            new_content = existing + "\n\n" + content if existing else content
            note_path.write_text(new_content)

            return jsonify({
                "filename": safe_name,
                "size_bytes": len(new_content),
                "response": f"Added to '{safe_name}'. The note now has {len(new_content)} characters."
            })

        # DELETE a note
        elif action == 'delete':
            if not filename:
                return jsonify({"error": "filename required", "response": "Which note should I delete?"})

            safe_name = sanitize_filename(filename)
            note_path = NOTES_DIR / safe_name

            if not note_path.exists():
                return jsonify({"error": "not found", "response": f"I don't have a note called '{filename}'."})

            note_path.unlink()
            return jsonify({
                "filename": safe_name,
                "deleted": True,
                "response": f"Deleted '{safe_name}'. Gone forever. Hope you didn't need that."
            })

        # SEARCH across all notes
        elif action == 'search' or search:
            search_term = search or content
            if not search_term:
                return jsonify({"error": "search term required", "response": "What are you looking for?"})

            results = []
            for f in NOTES_DIR.iterdir():
                if f.is_file() and f.suffix == '.md':
                    text = f.read_text()
                    if search_term.lower() in text.lower():
                        # Find the line containing the match
                        for i, line in enumerate(text.split('\n')):
                            if search_term.lower() in line.lower():
                                results.append({
                                    'filename': f.name,
                                    'line': i + 1,
                                    'context': line[:100]
                                })
                                break

            if not results:
                return jsonify({
                    "results": [],
                    "response": f"I couldn't find '{search_term}' in any of my notes."
                })

            return jsonify({
                "results": results,
                "count": len(results),
                "response": f"Found '{search_term}' in {len(results)} note{'s' if len(results) != 1 else ''}: {', '.join([r['filename'] for r in results])}"
            })

        else:
            return jsonify({"error": "invalid action", "response": f"Unknown action '{action}'. Use: list, read, write, append, delete, or search."})

    except Exception as e:
        print(f"Notes error: {e}")
        return jsonify({
            "error": str(e),
            "response": f"Something went wrong with my notes: {str(e)}"
        })

@app.route('/api/notes', methods=['POST'])
def create_note():
    """Create or update a note via POST"""
    data = request.get_json() or {}
    filename = data.get('filename')
    content = data.get('content')
    append = data.get('append', False)

    if not filename:
        return jsonify({"error": "filename required", "response": "What should I call this note?"})
    if not content:
        return jsonify({"error": "content required", "response": "What do you want me to write?"})

    safe_name = sanitize_filename(filename)
    note_path = NOTES_DIR / safe_name

    if append and note_path.exists():
        existing = note_path.read_text()
        content = existing + "\n\n" + content

    note_path.write_text(content)

    return jsonify({
        "filename": safe_name,
        "size_bytes": len(content),
        "response": f"{'Added to' if append else 'Saved'} '{safe_name}'."
    })

@app.route('/api/notes/<filename>', methods=['GET'])
def read_note(filename):
    """Read a specific note"""
    safe_name = sanitize_filename(filename)
    note_path = NOTES_DIR / safe_name

    if not note_path.exists():
        return jsonify({"error": "not found", "response": f"I don't have a note called '{filename}'."}), 404

    content = note_path.read_text()
    return jsonify({
        "filename": safe_name,
        "content": content,
        "size_bytes": len(content)
    })

@app.route('/api/notes/<filename>', methods=['DELETE'])
def delete_note(filename):
    """Delete a specific note"""
    safe_name = sanitize_filename(filename)
    note_path = NOTES_DIR / safe_name

    if not note_path.exists():
        return jsonify({"error": "not found", "response": f"I don't have a note called '{filename}'."}), 404

    note_path.unlink()
    return jsonify({
        "filename": safe_name,
        "deleted": True,
        "response": f"Deleted '{safe_name}'."
    })


# ===== PI-GUY JOB SCHEDULING SYSTEM =====

# Allowed job actions (whitelist) - maps to functions that execute the job
# Each action returns (success: bool, result: str)
JOB_ACTIONS = {
    'command': 'Execute a whitelisted server command',
    'note_write': 'Write or append to a note',
    'note_read': 'Read a note',
    'search': 'Search the web and save results',
    'server_status': 'Check server status',
    'memory_add': 'Add something to memory',
    'remind': 'Send a reminder (logs to job result)',
}

def parse_schedule(schedule_str):
    """
    Parse a schedule string into schedule_type and next_run time.

    Formats supported:
    - "in 5 minutes", "in 2 hours", "in 1 day"
    - "at 9:00", "at 14:30"
    - "daily at 9:00", "hourly", "every 5 minutes"
    - Cron: "0 9 * * *" (9am daily)

    Returns: (schedule_type, cron_expression, next_run_iso)
    """
    from datetime import timedelta
    import re

    schedule_str = schedule_str.lower().strip()
    now = datetime.now()

    # "in X minutes/hours/days" - one-time
    match = re.match(r'in\s+(\d+)\s+(minute|hour|day)s?', schedule_str)
    if match:
        amount = int(match.group(1))
        unit = match.group(2)
        if unit == 'minute':
            next_run = now + timedelta(minutes=amount)
        elif unit == 'hour':
            next_run = now + timedelta(hours=amount)
        elif unit == 'day':
            next_run = now + timedelta(days=amount)
        return ('once', None, next_run.isoformat())

    # "at HH:MM" - one-time today or tomorrow
    match = re.match(r'at\s+(\d{1,2}):(\d{2})', schedule_str)
    if match:
        hour = int(match.group(1))
        minute = int(match.group(2))
        next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if next_run <= now:
            next_run += timedelta(days=1)
        return ('once', None, next_run.isoformat())

    # "daily at HH:MM"
    match = re.match(r'daily\s+at\s+(\d{1,2}):(\d{2})', schedule_str)
    if match:
        hour = int(match.group(1))
        minute = int(match.group(2))
        cron = f"{minute} {hour} * * *"
        next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if next_run <= now:
            next_run += timedelta(days=1)
        return ('cron', cron, next_run.isoformat())

    # "hourly"
    if schedule_str == 'hourly':
        next_run = (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        return ('cron', '0 * * * *', next_run.isoformat())

    # "every X minutes"
    match = re.match(r'every\s+(\d+)\s+minutes?', schedule_str)
    if match:
        minutes = int(match.group(1))
        cron = f"*/{minutes} * * * *"
        next_run = now + timedelta(minutes=minutes)
        return ('cron', cron, next_run.isoformat())

    # "every X hours"
    match = re.match(r'every\s+(\d+)\s+hours?', schedule_str)
    if match:
        hours = int(match.group(1))
        cron = f"0 */{hours} * * *"
        next_run = now + timedelta(hours=hours)
        return ('cron', cron, next_run.isoformat())

    # Raw cron expression (5 parts)
    if re.match(r'^[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+\s+[\d\*\/\-\,]+$', schedule_str):
        # Calculate next run from cron (simplified - just use 1 minute from now for now)
        next_run = now + timedelta(minutes=1)
        return ('cron', schedule_str, next_run.isoformat())

    # Default: run in 1 minute
    return ('once', None, (now + timedelta(minutes=1)).isoformat())


def calculate_next_run(cron_expression):
    """Calculate next run time from a cron expression (simplified)"""
    from datetime import timedelta
    import re

    now = datetime.now()
    parts = cron_expression.split()
    if len(parts) != 5:
        return (now + timedelta(minutes=1)).isoformat()

    minute, hour, day, month, dow = parts

    # Handle simple cases
    if minute.startswith('*/'):
        # Every N minutes
        interval = int(minute[2:])
        next_min = ((now.minute // interval) + 1) * interval
        if next_min >= 60:
            return (now + timedelta(hours=1)).replace(minute=0, second=0).isoformat()
        return now.replace(minute=next_min, second=0).isoformat()

    if hour.startswith('*/'):
        # Every N hours
        interval = int(hour[2:])
        next_hour = ((now.hour // interval) + 1) * interval
        if next_hour >= 24:
            return (now + timedelta(days=1)).replace(hour=0, minute=0, second=0).isoformat()
        return now.replace(hour=next_hour, minute=0, second=0).isoformat()

    # Daily at specific time
    if minute.isdigit() and hour.isdigit():
        target = now.replace(hour=int(hour), minute=int(minute), second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        return target.isoformat()

    # Default: 1 hour from now
    return (now + timedelta(hours=1)).isoformat()


def execute_job_action(action, params):
    """
    Execute a job action and return (success, result).
    This is the core executor for scheduled jobs.
    """
    try:
        params = json.loads(params) if isinstance(params, str) else (params or {})

        if action == 'command':
            # Run a whitelisted command
            cmd_name = params.get('command', 'date')
            if cmd_name not in ALLOWED_COMMANDS:
                return False, f"Command '{cmd_name}' not in whitelist"

            cmd_info = ALLOWED_COMMANDS[cmd_name]
            result = subprocess.run(
                cmd_info['cmd'],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=cmd_info.get('cwd')
            )
            output = result.stdout.strip() or result.stderr.strip()
            return result.returncode == 0, output[:1000]

        elif action == 'note_write':
            # Write to a note
            filename = params.get('filename', 'job_output')
            content = params.get('content', '')
            append = params.get('append', True)

            safe_name = sanitize_filename(filename)
            note_path = NOTES_DIR / safe_name

            if append and note_path.exists():
                existing = note_path.read_text()
                content = existing + f"\n\n[{datetime.now().isoformat()}]\n{content}"

            note_path.write_text(content)
            return True, f"Wrote to {safe_name}"

        elif action == 'note_read':
            # Read a note
            filename = params.get('filename')
            if not filename:
                return False, "No filename specified"

            safe_name = sanitize_filename(filename)
            note_path = NOTES_DIR / safe_name

            if not note_path.exists():
                return False, f"Note '{filename}' not found"

            content = note_path.read_text()
            return True, content[:1000]

        elif action == 'search':
            # Web search
            query = params.get('query')
            if not query:
                return False, "No search query specified"

            # Use same search logic as the endpoint
            import urllib.request
            import urllib.parse

            encoded_query = urllib.parse.quote_plus(query)
            url = f"https://html.duckduckgo.com/html/?q={encoded_query}"

            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
            })

            with urllib.request.urlopen(req, timeout=10) as response:
                html = response.read().decode('utf-8')

            # Simple extraction of first few results
            results = []
            import re
            for match in re.finditer(r'class="result__a"[^>]*>([^<]+)</a>', html):
                results.append(match.group(1).strip())
                if len(results) >= 3:
                    break

            return True, f"Search '{query}': {', '.join(results) if results else 'No results'}"

        elif action == 'server_status':
            # Get server status
            cpu = psutil.cpu_percent(interval=0.5)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage('/')

            status = f"CPU: {cpu}%, Memory: {mem.percent}%, Disk: {disk.percent}%"
            return True, status

        elif action == 'memory_add':
            # Add to memory (calls the memory endpoint logic)
            name = params.get('name')
            content = params.get('content')
            if not name or not content:
                return False, "Name and content required for memory_add"

            # Would need to call the memory functions directly
            return True, f"Memory '{name}' would be added (not implemented in job runner yet)"

        elif action == 'remind':
            # Simple reminder - just logs
            message = params.get('message', 'Reminder!')
            return True, f"REMINDER: {message}"

        else:
            return False, f"Unknown action: {action}"

    except subprocess.TimeoutExpired:
        return False, "Command timed out"
    except Exception as e:
        return False, f"Error: {str(e)}"


@app.route('/api/jobs', methods=['GET'])
def handle_jobs():
    """
    All-in-one jobs endpoint for Hume tool.
    Query params:
      - action: 'list', 'schedule', 'cancel', 'status', 'history'
      - name: job name (for schedule)
      - schedule: when to run (e.g., "in 5 minutes", "daily at 9:00")
      - job_action: what to do (command, note_write, search, etc.)
      - params: JSON string of action parameters
      - job_id: for cancel/status/history
    """
    action = request.args.get('action', 'list')
    name = request.args.get('name', '')
    schedule = request.args.get('schedule', '')
    job_action = request.args.get('job_action', '')
    params = request.args.get('params', '{}')
    job_id = request.args.get('job_id', '')

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    now = datetime.now().isoformat()

    try:
        # LIST jobs
        if action == 'list':
            status_filter = request.args.get('status', '')  # pending, running, completed, failed, cancelled

            if status_filter:
                c.execute('SELECT * FROM jobs WHERE status = ? ORDER BY next_run ASC', (status_filter,))
            else:
                c.execute('SELECT * FROM jobs ORDER BY CASE WHEN status = "pending" THEN 0 WHEN status = "running" THEN 1 ELSE 2 END, next_run ASC')

            rows = c.fetchall()
            jobs = [dict(row) for row in rows]

            if not jobs:
                return jsonify({
                    "jobs": [],
                    "count": 0,
                    "response": "No jobs scheduled. Tell me to schedule something!"
                })

            # Summarize
            pending = [j for j in jobs if j['status'] == 'pending']
            completed = [j for j in jobs if j['status'] == 'completed']

            summary_parts = []
            if pending:
                next_job = pending[0]
                summary_parts.append(f"{len(pending)} pending, next: '{next_job['name']}' at {next_job['next_run'][:16]}")
            if completed:
                summary_parts.append(f"{len(completed)} completed")

            return jsonify({
                "jobs": jobs,
                "count": len(jobs),
                "response": f"I have {len(jobs)} job(s). {'; '.join(summary_parts)}"
            })

        # SCHEDULE a new job
        elif action == 'schedule':
            if not name:
                return jsonify({"error": "name required", "response": "What should I call this job?"})
            if not schedule:
                return jsonify({"error": "schedule required", "response": "When should I run this? e.g., 'in 5 minutes', 'daily at 9:00'"})
            if not job_action:
                return jsonify({"error": "job_action required", "response": f"What should I do? Options: {', '.join(JOB_ACTIONS.keys())}"})
            if job_action not in JOB_ACTIONS:
                return jsonify({"error": "invalid job_action", "response": f"Unknown action '{job_action}'. Options: {', '.join(JOB_ACTIONS.keys())}"})

            # Parse schedule
            schedule_type, cron_expr, next_run = parse_schedule(schedule)

            # Validate params JSON
            try:
                json.loads(params) if params else {}
            except:
                return jsonify({"error": "invalid params", "response": "The params must be valid JSON"})

            c.execute('''
                INSERT INTO jobs (name, job_type, schedule_type, cron_expression, next_run, status, action, action_params, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
            ''', (name, job_action, schedule_type, cron_expr, next_run, job_action, params, now, now))

            job_id = c.lastrowid
            conn.commit()

            schedule_desc = f"once at {next_run[:16]}" if schedule_type == 'once' else f"recurring ({cron_expr})"

            return jsonify({
                "job_id": job_id,
                "name": name,
                "schedule_type": schedule_type,
                "next_run": next_run,
                "response": f"Scheduled job '{name}' to {JOB_ACTIONS[job_action]} {schedule_desc}."
            })

        # CANCEL a job
        elif action == 'cancel':
            if not job_id and not name:
                return jsonify({"error": "job_id or name required", "response": "Which job should I cancel?"})

            if job_id:
                c.execute('UPDATE jobs SET status = "cancelled", updated_at = ? WHERE id = ? AND status = "pending"', (now, job_id))
            else:
                c.execute('UPDATE jobs SET status = "cancelled", updated_at = ? WHERE name LIKE ? AND status = "pending"', (now, f'%{name}%'))

            affected = c.rowcount
            conn.commit()

            if affected > 0:
                return jsonify({"cancelled": affected, "response": f"Cancelled {affected} job(s)."})
            return jsonify({"cancelled": 0, "response": "No matching pending jobs found to cancel."})

        # STATUS of a specific job
        elif action == 'status':
            if not job_id and not name:
                return jsonify({"error": "job_id or name required", "response": "Which job do you want status for?"})

            if job_id:
                c.execute('SELECT * FROM jobs WHERE id = ?', (job_id,))
            else:
                c.execute('SELECT * FROM jobs WHERE name LIKE ? ORDER BY created_at DESC LIMIT 1', (f'%{name}%',))

            row = c.fetchone()
            if not row:
                return jsonify({"error": "not found", "response": "Couldn't find that job."})

            job = dict(row)
            return jsonify({
                "job": job,
                "response": f"Job '{job['name']}': status={job['status']}, next_run={job['next_run'][:16] if job['next_run'] else 'N/A'}, last_result={job['result'][:100] if job['result'] else 'none'}"
            })

        # HISTORY of job runs
        elif action == 'history':
            limit = int(request.args.get('limit', 10))

            if job_id:
                c.execute('SELECT * FROM job_history WHERE job_id = ? ORDER BY run_at DESC LIMIT ?', (job_id, limit))
            else:
                c.execute('SELECT jh.*, j.name FROM job_history jh JOIN jobs j ON jh.job_id = j.id ORDER BY run_at DESC LIMIT ?', (limit,))

            rows = c.fetchall()
            history = [dict(row) for row in rows]

            if not history:
                return jsonify({"history": [], "response": "No job history yet."})

            return jsonify({
                "history": history,
                "count": len(history),
                "response": f"Last {len(history)} job runs shown."
            })

        # RUN a job immediately (for testing)
        elif action == 'run':
            if not job_id and not name:
                return jsonify({"error": "job_id or name required", "response": "Which job should I run now?"})

            if job_id:
                c.execute('SELECT * FROM jobs WHERE id = ?', (job_id,))
            else:
                c.execute('SELECT * FROM jobs WHERE name LIKE ? AND status = "pending" ORDER BY created_at DESC LIMIT 1', (f'%{name}%',))

            row = c.fetchone()
            if not row:
                return jsonify({"error": "not found", "response": "Couldn't find that job."})

            job = dict(row)

            # Execute the job
            start_time = datetime.now()
            success, result = execute_job_action(job['action'], job['action_params'])
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)

            new_status = 'completed' if success else 'failed'

            # Update job
            if job['schedule_type'] == 'once':
                c.execute('UPDATE jobs SET status = ?, last_run = ?, result = ?, updated_at = ? WHERE id = ?',
                         (new_status, now, result, now, job['id']))
            else:
                # Recurring job - calculate next run
                next_run = calculate_next_run(job['cron_expression']) if job['cron_expression'] else now
                c.execute('UPDATE jobs SET status = "pending", last_run = ?, next_run = ?, result = ?, updated_at = ? WHERE id = ?',
                         (now, next_run, result, now, job['id']))

            # Record history
            c.execute('INSERT INTO job_history (job_id, run_at, status, result, duration_ms) VALUES (?, ?, ?, ?, ?)',
                     (job['id'], now, new_status, result, duration_ms))

            conn.commit()

            return jsonify({
                "job_id": job['id'],
                "success": success,
                "result": result,
                "duration_ms": duration_ms,
                "response": f"Ran '{job['name']}': {'Success' if success else 'Failed'} - {result[:100]}"
            })

        else:
            return jsonify({
                "error": "invalid action",
                "response": f"Unknown action '{action}'. Use: list, schedule, cancel, status, history, run"
            })

    except Exception as e:
        print(f"Jobs error: {e}")
        return jsonify({"error": str(e), "response": f"Something went wrong with jobs: {str(e)}"})

    finally:
        conn.close()


@app.route('/api/jobs/run-pending', methods=['POST'])
def run_pending_jobs():
    """
    Run all pending jobs that are due. Called by cron every minute.
    This is the job runner endpoint.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    now = datetime.now()
    now_iso = now.isoformat()

    results = []

    try:
        # Find all pending jobs where next_run <= now
        c.execute('SELECT * FROM jobs WHERE status = "pending" AND next_run <= ?', (now_iso,))
        due_jobs = c.fetchall()

        for job in due_jobs:
            job = dict(job)
            job_id = job['id']

            # Mark as running
            c.execute('UPDATE jobs SET status = "running", updated_at = ? WHERE id = ?', (now_iso, job_id))
            conn.commit()

            # Execute
            start_time = datetime.now()
            success, result = execute_job_action(job['action'], job['action_params'])
            duration_ms = int((datetime.now() - start_time).total_seconds() * 1000)

            new_status = 'completed' if success else 'failed'

            # Update job
            if job['schedule_type'] == 'once':
                c.execute('UPDATE jobs SET status = ?, last_run = ?, result = ?, updated_at = ? WHERE id = ?',
                         (new_status, now_iso, result, now_iso, job_id))
            else:
                # Recurring - calculate next run
                next_run = calculate_next_run(job['cron_expression']) if job['cron_expression'] else now_iso
                c.execute('UPDATE jobs SET status = "pending", last_run = ?, next_run = ?, result = ?, updated_at = ? WHERE id = ?',
                         (now_iso, next_run, result, now_iso, job_id))

            # Record history
            c.execute('INSERT INTO job_history (job_id, run_at, status, result, duration_ms) VALUES (?, ?, ?, ?, ?)',
                     (job_id, now_iso, new_status, result, duration_ms))

            conn.commit()

            results.append({
                "job_id": job_id,
                "name": job['name'],
                "success": success,
                "result": result[:200]
            })

        return jsonify({
            "ran": len(results),
            "results": results,
            "checked_at": now_iso
        })

    except Exception as e:
        print(f"Job runner error: {e}")
        return jsonify({"error": str(e)}), 500

    finally:
        conn.close()


@app.route('/api/jobs/actions', methods=['GET'])
def list_job_actions():
    """List all available job actions"""
    return jsonify({
        "actions": JOB_ACTIONS,
        "response": f"Available job actions: {', '.join(JOB_ACTIONS.keys())}"
    })


# ===== DJ-FOAMBOT MEMORY SYSTEM (Local JSON Storage) =====

MEMORY_FILE = Path(__file__).parent / "memories.json"

def load_memories():
    """Load all memories from local JSON file"""
    if MEMORY_FILE.exists():
        with open(MEMORY_FILE) as f:
            return json.load(f)
    return {}

def save_memories(memories):
    """Save memories to local JSON file"""
    with open(MEMORY_FILE, 'w') as f:
        json.dump(memories, f, indent=2)

@app.route('/api/memory', methods=['GET'])
def handle_memory():
    """
    All-in-one memory endpoint for Hume tool
    Uses local JSON storage for persistence.

    Query params:
      - action: 'list', 'read', 'remember', 'forget', 'search'
      - name: memory name (for read/remember/forget)
      - content: content to remember (for remember)
      - search: search term (for search)
    """
    action = request.args.get('action', 'list')
    name = request.args.get('name', '')
    content = request.args.get('content', '')
    search_term = request.args.get('search', '')

    try:
        memories = load_memories()

        # LIST all memories
        if action == 'list':
            if not memories:
                return jsonify({
                    "memories": [],
                    "count": 0,
                    "response": "I don't have any memories stored yet. Tell me to remember something!"
                })

            memory_names = list(memories.keys())
            return jsonify({
                "memories": memory_names,
                "count": len(memory_names),
                "response": f"I remember {len(memory_names)} thing{'s' if len(memory_names) != 1 else ''}: {', '.join(memory_names)}"
            })

        # READ a specific memory
        elif action == 'read':
            if not name:
                return jsonify({"error": "name required", "response": "Which memory do you want me to recall?"})

            # Fuzzy match
            matched_name = None
            name_lower = name.lower()
            for mem_name in memories.keys():
                if name_lower in mem_name.lower() or mem_name.lower() in name_lower:
                    matched_name = mem_name
                    break

            if not matched_name:
                return jsonify({
                    "error": "not found",
                    "response": f"I don't remember anything called '{name}'. Use 'list memories' to see what I know."
                })

            memory_content = memories[matched_name].get('content', '')
            created_at = memories[matched_name].get('created_at', 'Unknown')

            return jsonify({
                "name": matched_name,
                "content": memory_content,
                "created_at": created_at,
                "response": f"Here's what I remember about '{matched_name}':\n\n{memory_content[:500]}{'...' if len(str(memory_content)) > 500 else ''}"
            })

        # REMEMBER something new
        elif action == 'remember':
            if not name:
                return jsonify({"error": "name required", "response": "What should I call this memory?"})
            if not content:
                return jsonify({"error": "content required", "response": "What do you want me to remember?"})

            # Store the memory
            memories[name] = {
                "content": content,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
            save_memories(memories)

            return jsonify({
                "name": name,
                "response": f"Got it! I'll remember '{name}'. This is now part of my knowledge."
            })

        # FORGET a memory
        elif action == 'forget':
            if not name:
                return jsonify({"error": "name required", "response": "What should I forget?"})

            # Fuzzy match
            matched_name = None
            name_lower = name.lower()
            for mem_name in memories.keys():
                if name_lower in mem_name.lower() or mem_name.lower() in name_lower:
                    matched_name = mem_name
                    break

            if not matched_name:
                return jsonify({
                    "error": "not found",
                    "response": f"I don't have a memory called '{name}' to forget."
                })

            # Delete the memory
            del memories[matched_name]
            save_memories(memories)

            return jsonify({
                "name": matched_name,
                "forgotten": True,
                "response": f"Done. I've forgotten '{matched_name}'. It's gone from my memory."
            })

        # SEARCH memories
        elif action == 'search':
            if not search_term:
                search_term = content or name
            if not search_term:
                return jsonify({"error": "search term required", "response": "What are you looking for in my memories?"})

            # Search through memories
            results = []
            for mem_name, mem_data in memories.items():
                mem_content = mem_data.get('content', '')
                if search_term.lower() in mem_content.lower() or search_term.lower() in mem_name.lower():
                    results.append({
                        "name": mem_name,
                        "preview": mem_content[:200] if mem_content else "No content"
                    })

            if not results:
                return jsonify({
                    "results": [],
                    "response": f"I couldn't find '{search_term}' in any of my memories."
                })

            return jsonify({
                "results": results,
                "count": len(results),
                "response": f"Found '{search_term}' in {len(results)} memor{'ies' if len(results) != 1 else 'y'}: {', '.join([r['name'] for r in results])}"
            })

        else:
            return jsonify({
                "error": "invalid action",
                "response": f"Unknown action '{action}'. Use: list, read, remember, forget, or search."
            })

    except Exception as e:
        print(f"Memory error: {e}")
        return jsonify({
            "error": str(e),
            "response": f"Something went wrong with my memory: {str(e)}"
        }), 500

@app.route('/api/memory/export', methods=['GET'])
def export_memories():
    """Export all memories as JSON (for backup)"""
    try:
        memories = load_memories()
        return jsonify({
            "memories": memories,
            "count": len(memories),
            "exported_at": datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/memory/import', methods=['POST'])
def import_memories():
    """Import memories from JSON (for restore)"""
    try:
        data = request.get_json()
        if not data or 'memories' not in data:
            return jsonify({"error": "No memories data provided"}), 400

        # Merge with existing memories
        memories = load_memories()
        imported = data['memories']

        for name, content in imported.items():
            if isinstance(content, dict):
                memories[name] = content
            else:
                # Handle simple string format
                memories[name] = {
                    "content": content,
                    "created_at": datetime.now().isoformat(),
                    "imported": True
                }

        save_memories(memories)

        return jsonify({
            "imported": len(imported),
            "total": len(memories),
            "response": f"Imported {len(imported)} memories. Total: {len(memories)}"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500




# ===== FILE UPLOAD =====
UPLOADS_DIR = Path(__file__).parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Upload a file for the voice agent to use (images, text, etc.)"""
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({"error": "No filename"}), 400

    # Validate extension
    allowed = {'.png', '.jpg', '.jpeg', '.gif', '.webp',
               '.pdf', '.txt', '.md', '.json', '.csv',
               '.html', '.js', '.py', '.ts', '.css'}
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed:
        return jsonify({"error": f"File type {ext} not allowed"}), 400

    # Sanitize filename
    safe_name = re.sub(r'[^\w\-.]', '_', file.filename)[:80]
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    save_name = f"{timestamp}_{safe_name}"
    save_path = UPLOADS_DIR / save_name
    file.save(save_path)

    is_image = ext in {'.png', '.jpg', '.jpeg', '.gif', '.webp'}

    result = {
        "filename": save_name,
        "original_name": file.filename,
        "path": str(save_path),
        "type": "image" if is_image else "text",
        "size": save_path.stat().st_size,
        "url": f"/uploads/{save_name}"
    }

    # For text files, include content preview so agent sees it immediately
    if not is_image and ext != '.pdf':
        try:
            content = save_path.read_text(encoding='utf-8', errors='replace')[:2000]
            result["content_preview"] = content
        except Exception:
            pass

    logger.info(f"File uploaded: {file.filename} -> {save_path} ({save_path.stat().st_size} bytes)")
    return jsonify(result)



# ===== CLAWDBOT WEBSOCKET PROXY =====
def generate_tts_audio(text: str) -> bytes:
    """
    Generate TTS audio (delegates to services.tts).

    Args:
        text: The text to synthesize

    Returns:
        Audio bytes (WAV or MP3 depending on active provider)
    """
    import base64 as _b64
    b64 = _tts_generate_b64(text, voice='M1')
    if b64 is None:
        raise RuntimeError("TTS generation failed")
    return _b64.b64decode(b64)


@sock.route('/ws/clawdbot')
def clawdbot_websocket(ws):
    """
    WebSocket proxy between frontend and clawdbot Gateway.
    Handles TTS generation for assistant responses.

    This endpoint:
    1. Connects to the clawdbot Gateway at ws://127.0.0.1:18789
    2. Performs handshake with Gateway (protocol version 3)
    3. Proxies messages bidirectionally:
       - Frontend → Gateway: chat.send messages
       - Gateway → Frontend: agent.message events with TTS audio
    4. Generates TTS audio using Supertonic integration
    """
    logger = logging.getLogger(__name__)
    gateway_url = os.getenv('CLAWDBOT_GATEWAY_URL', 'ws://127.0.0.1:18791')
    auth_token = os.getenv('CLAWDBOT_AUTH_TOKEN')

    if not auth_token:
        logger.error("CLAWDBOT_AUTH_TOKEN not configured")
        ws.send(json.dumps({"type": "error", "message": "Server configuration error"}))
        ws.close()
        return

    async def run_websocket():
        try:
            async with websockets.connect(gateway_url) as gateway_ws:
                logger.info(f"Connected to clawdbot Gateway at {gateway_url}")

                # Step 1: Receive connect.challenge event from Gateway
                challenge_msg = await gateway_ws.recv()
                challenge_data = json.loads(challenge_msg)
                logger.info(f"Received challenge: {challenge_data.get('event')}")

                # Step 2: Send connect request with auth token
                handshake = {
                    "type": "req",
                    "id": f"connect-{uuid.uuid4()}",
                    "method": "connect",
                    "params": {
                        "minProtocol": 3,
                        "maxProtocol": 3,
                        "client": {
                            "id": "webchat",  # Gateway client ID
                            "version": "1.0.0",
                            "platform": "web",
                            "mode": "webchat"  # Required: client mode
                        },
                        "auth": {"token": auth_token}
                    }
                }

                await gateway_ws.send(json.dumps(handshake))
                logger.info("Sent handshake to clawdbot Gateway")

                # Step 3: Wait for connect response (res)
                hello_response = await gateway_ws.recv()
                hello_data = json.loads(hello_response)

                # Check if response is successful (ok: true)
                if hello_data.get('type') != 'res' or not hello_data.get('ok'):
                    logger.error(f"Gateway handshake failed: {hello_data}")
                    ws.send(json.dumps({"type": "error", "message": "Gateway handshake failed"}))
                    ws.close()
                    return

                logger.info("Clawdbot Gateway handshake successful!")

                # Send connected confirmation to frontend
                ws.send(json.dumps({
                    "type": "connected",
                    "message": "Connected to Clawdbot"
                }))

                # Bidirectional message forwarding
                async def forward_to_gateway():
                    """Forward messages from frontend to Gateway."""
                    try:
                        while True:
                            # Receive from frontend (flask-sock uses blocking receive)
                            message = ws.receive()
                            if not message:
                                break

                            data = json.loads(message)

                            if data.get('type') == 'chat.send':
                                # Forward to Gateway
                                chat_request = {
                                    "type": "req",
                                    "id": f"chat-{uuid.uuid4()}",
                                    "method": "chat.send",
                                    "params": {
                                        "content": data.get('content', ''),
                                        "sessionKey": data.get('sessionKey', 'main')
                                    }
                                }
                                await gateway_ws.send(json.dumps(chat_request))
                                logger.info(f"Forwarded chat message to Gateway")
                    except Exception as e:
                        logger.error(f"Error in forward_to_gateway: {e}")

                async def forward_to_frontend():
                    """Forward messages from Gateway to frontend with TTS."""
                    try:
                        while True:
                            # Receive from Gateway
                            gateway_message = await gateway_ws.recv()
                            data = json.loads(gateway_message)

                            if data.get('type') == 'event':
                                event = data.get('event')

                                if event == 'agent.message':
                                    # Generate TTS for assistant response
                                    content = data.get('payload', {}).get('content', '')

                                    if content:
                                        try:
                                            # Generate TTS audio
                                            audio_bytes = generate_tts_audio(content)
                                            audio_base64 = base64.b64encode(audio_bytes).decode()

                                            # Send to frontend with audio
                                            response = {
                                                "type": "assistant_message",
                                                "text": content,
                                                "audio": audio_base64
                                            }
                                            ws.send(json.dumps(response))
                                            logger.info(f"Sent assistant message with TTS to frontend")
                                        except Exception as e:
                                            logger.error(f"TTS generation failed: {e}")
                                            # Send text-only response
                                            ws.send(json.dumps({
                                                "type": "assistant_message",
                                                "text": content
                                            }))

                                elif event == 'agent.stream.delta':
                                    # Streaming text delta
                                    delta = data.get('payload', {}).get('delta', '')
                                    ws.send(json.dumps({
                                        "type": "text_delta",
                                        "delta": delta
                                    }))

                                elif event == 'agent.stream.end':
                                    # Stream ended
                                    ws.send(json.dumps({
                                        "type": "stream_end"
                                    }))

                    except Exception as e:
                        logger.error(f"Error in forward_to_frontend: {e}")

                # Run both forwarding tasks concurrently
                await asyncio.gather(
                    forward_to_gateway(),
                    forward_to_frontend()
                )

        except (ConnectionRefusedError, OSError) as e:
            logger.error(f"Failed to connect to clawdbot Gateway at {gateway_url}: {e}")
            ws.send(json.dumps({
                "type": "error",
                "message": "Failed to connect to Clawdbot Gateway"
            }))
            ws.close()
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
            ws.send(json.dumps({
                "type": "error",
                "message": str(e)
            }))
            ws.close()

    # Run the async WebSocket handler
    try:
        asyncio.run(run_websocket())
    except Exception as e:
        logger.error(f"Fatal WebSocket error: {e}")


if __name__ == '__main__':
    import signal
    import socket

    port = int(os.getenv('PORT', 5000))

    # SIGTERM handling: Exit cleanly with status 0.
    # With Restart=on-failure, a clean exit (0) does NOT trigger restart.
    # Only crashes/signals trigger restart. This lets systemctl stop/restart work properly.
    def handle_sigterm(signum, frame):
        print(f"SIGTERM received — shutting down cleanly", flush=True)
        os._exit(0)
    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGHUP, signal.SIG_IGN)

    print(f"Starting OpenVoiceUI Server on port {port}")
    print(f"Vision endpoint: http://localhost:{port}/api/vision")
    print(f"Todo endpoint: http://localhost:{port}/api/todos")
    print(f"Search endpoint: http://localhost:{port}/api/search")
    print(f"Command endpoint: http://localhost:{port}/api/command")
    print(f"Memory endpoint: http://localhost:{port}/api/memory")
    print(f"DJ Sound endpoint: http://localhost:{port}/api/dj-sound")
    print(f"TTS Providers endpoint: http://localhost:{port}/api/tts/providers")
    print(f"TTS Generate endpoint: http://localhost:{port}/api/tts/generate")
    app.run(host='127.0.0.1', port=port, debug=False, threaded=True)
