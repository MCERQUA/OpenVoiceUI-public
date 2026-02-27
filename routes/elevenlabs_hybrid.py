"""
routes/elevenlabs_hybrid.py — ElevenLabs + OpenClaw Hybrid Blueprint (P7-T5)

Provides two endpoints that form the bridge between ElevenLabs Conversational
AI (voice layer) and OpenClaw / Clawdbot Gateway (brain layer):

    POST /api/elevenlabs-llm
        Custom LLM endpoint configured in the ElevenLabs hybrid agent.
        Receives the conversation context, extracts the latest user message,
        forwards it to the Clawdbot Gateway using the persistent WebSocket
        connection, strips canvas/HTML markers from the response, then
        returns clean text to ElevenLabs in OpenAI-compatible SSE format
        so ElevenLabs TTS can begin speaking as the first tokens arrive.

    GET  /api/canvas-pending
        Side-channel for canvas commands extracted from OpenClaw responses.
        Returns and clears the pending canvas command queue so the frontend
        adapter (ElevenLabsHybridAdapter._startCanvasPolling) can load the
        correct iframe without the agent reading HTML aloud.

Architecture:
    Browser (ElevenLabs SDK)
        → POST /api/elevenlabs-llm  (this module)
            → gateway_connection.stream_to_queue(session='voice-elevenlabs-hybrid')
            ← streaming text chunks
        → SSE to ElevenLabs TTS

    OpenClaw response:  "Dashboard ready! {canvas:present,url:/pages/stats.html} Check it out."
    Spoken text:        "Dashboard ready!  Check it out."
    Canvas queue:       [{"action": "present", "url": "/pages/stats.html"}]
    GET /api/canvas-pending returns → {"commands": [{"action": "present", "url": "..."}]}

Ref: future-dev-plans/16-ELEVENLABS-OPENCLAW-HYBRID.md
Ref: ADR-008 (Fallback chains — graceful degradation on Gateway unavailability)
"""

import json
import logging
import os
import queue
import re
import threading
from collections import deque

from flask import Blueprint, Response, jsonify, request

from services.gateway import gateway_connection

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Blueprint
# ---------------------------------------------------------------------------

elevenlabs_hybrid_bp = Blueprint('elevenlabs_hybrid', __name__)

# ---------------------------------------------------------------------------
# Session key
# Separate from ClawdBot's voice-main-N key so histories don't collide.
# ---------------------------------------------------------------------------

HYBRID_SESSION_KEY = os.getenv('ELEVENLABS_HYBRID_SESSION_KEY', 'voice-elevenlabs-hybrid')

# Optional shared secret for validating requests from ElevenLabs
HYBRID_LLM_SECRET = os.getenv('ELEVENLABS_HYBRID_LLM_SECRET', '')

# ---------------------------------------------------------------------------
# Canvas command side-channel
# Thread-safe deque; items are dicts: {"action": "present"|"close", "url": str}
# ---------------------------------------------------------------------------

_canvas_pending: deque = deque()
_canvas_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Canvas extraction helpers
# ---------------------------------------------------------------------------

_CANVAS_PATTERN = re.compile(r'\{canvas:(\w+),url:([^}]+)\}')
_HTML_BLOCK_PATTERN = re.compile(r'```html[\s\S]*?```', re.IGNORECASE)


def _extract_canvas_commands(text: str) -> list:
    """
    Parse {canvas:action,url:path} markers from OpenClaw response text.

    Returns a list of {"action": str, "url": str} dicts.
    """
    commands = []
    for match in _CANVAS_PATTERN.finditer(text):
        commands.append({
            'action': match.group(1),   # 'present', 'close', etc.
            'url':    match.group(2).strip(),
        })
    return commands


def _strip_canvas_markers(text: str) -> str:
    """
    Remove {canvas:...} markers and raw ```html``` blocks from spoken text
    so ElevenLabs TTS doesn't read them aloud.
    """
    text = _CANVAS_PATTERN.sub('', text)
    text = _HTML_BLOCK_PATTERN.sub('', text)
    return text.strip()


def _queue_canvas_commands(commands: list) -> None:
    """Append extracted canvas commands to the pending queue (thread-safe)."""
    if not commands:
        return
    with _canvas_lock:
        for cmd in commands:
            _canvas_pending.append(cmd)


# ---------------------------------------------------------------------------
# POST /api/elevenlabs-llm — custom LLM endpoint
# ---------------------------------------------------------------------------

@elevenlabs_hybrid_bp.route('/api/elevenlabs-llm', methods=['POST'])
def elevenlabs_custom_llm():
    """
    Bridge ElevenLabs voice to OpenClaw brain.

    ElevenLabs sends the full conversation context in OpenAI chat format:
        {"messages": [{"role": "system"/"user"/"assistant", "content": "..."}]}

    We extract the latest user message, forward to Gateway, stream the
    response back as OpenAI-compatible SSE so ElevenLabs TTS can start
    speaking on the first sentence rather than waiting for the full reply.

    Fallback (ADR-008): if Gateway is unreachable, returns a graceful
    error response so ElevenLabs speaks an apology rather than hanging.
    """

    # ── Optional shared-secret auth ──────────────────────────────────────────
    if HYBRID_LLM_SECRET:
        auth_header = request.headers.get('Authorization', '')
        if auth_header != f'Bearer {HYBRID_LLM_SECRET}':
            return jsonify({'error': 'Unauthorized'}), 401

    # ── Parse request ─────────────────────────────────────────────────────────
    data     = request.get_json(silent=True) or {}
    messages = data.get('messages', [])

    if not messages:
        return _openai_error_response("No messages provided"), 400

    # Extract the latest user turn (last message with role 'user')
    user_message = ''
    for msg in reversed(messages):
        if msg.get('role') == 'user':
            user_message = msg.get('content', '')
            break

    if not user_message:
        return _openai_error_response("No user message found in context"), 400

    logger.info(f"[ElevenLabsHybrid] Custom LLM request: {user_message[:80]!r}")

    # ── Check Gateway availability ────────────────────────────────────────────
    if not gateway_connection.is_configured():
        logger.warning('[ElevenLabsHybrid] Gateway not configured — returning fallback response')
        return _openai_sync_response(
            "Sorry, my connection to the server brain is not configured right now. "
            "Please check the CLAWDBOT_AUTH_TOKEN environment variable."
        )

    # ── Stream from Gateway → SSE to ElevenLabs ──────────────────────────────

    def generate():
        """Generator: reads Gateway events, yields OpenAI SSE chunks."""
        event_queue: queue.Queue = queue.Queue()
        captured_actions = []
        full_response_parts = []

        # Run stream_to_queue in a background thread so we can yield from
        # the main thread (Flask's response generator must be synchronous).
        stream_thread = threading.Thread(
            target=gateway_connection.stream_to_queue,
            args=(event_queue, user_message, HYBRID_SESSION_KEY, captured_actions),
            daemon=True,
        )
        stream_thread.start()

        try:
            while True:
                try:
                    event = event_queue.get(timeout=60)
                except queue.Empty:
                    logger.warning('[ElevenLabsHybrid] Gateway stream timeout')
                    break

                etype = event.get('type')

                if etype == 'delta':
                    chunk_text = event.get('text', '')
                    if chunk_text:
                        full_response_parts.append(chunk_text)
                        # Strip canvas markers from streaming chunks
                        clean_chunk = _strip_canvas_markers(chunk_text)
                        if clean_chunk:
                            yield _sse_delta(clean_chunk)

                elif etype == 'text_done':
                    full_response = event.get('response') or ''.join(full_response_parts)
                    # Extract canvas commands from the full response
                    canvas_cmds = _extract_canvas_commands(full_response)
                    _queue_canvas_commands(canvas_cmds)
                    if canvas_cmds:
                        logger.info(f'[ElevenLabsHybrid] Queued {len(canvas_cmds)} canvas command(s)')
                    break

                elif etype == 'error':
                    error_msg = event.get('error', 'Unknown Gateway error')
                    logger.error(f'[ElevenLabsHybrid] Gateway error: {error_msg}')
                    yield _sse_delta("I'm having trouble connecting right now. Please try again.")
                    break

                elif etype == 'handshake':
                    # Connection established — nothing to yield to ElevenLabs
                    continue

                # 'action' events: tool use / lifecycle events — log only
                elif etype == 'action':
                    action_name = event.get('action', {}).get('type', 'unknown')
                    logger.debug(f'[ElevenLabsHybrid] Gateway action: {action_name}')

        finally:
            yield 'data: [DONE]\n\n'

        stream_thread.join(timeout=5)

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control':   'no-cache',
            'X-Accel-Buffering': 'no',   # disable nginx buffering for SSE
        },
    )


# ---------------------------------------------------------------------------
# GET /api/canvas-pending — canvas command side-channel
# ---------------------------------------------------------------------------

@elevenlabs_hybrid_bp.route('/api/canvas-pending', methods=['GET'])
def canvas_pending():
    """
    Return and clear the pending canvas command queue.

    The ElevenLabsHybridAdapter frontend polls this endpoint every second
    during a hybrid conversation.  When OpenClaw creates a canvas page, the
    command appears here; the frontend then loads the iframe.

    Response:
        {"commands": [{"action": "present", "url": "/pages/stats.html"}, ...]}

    Commands are consumed (cleared) on each call.
    """
    with _canvas_lock:
        commands = list(_canvas_pending)
        _canvas_pending.clear()

    return jsonify({'commands': commands})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sse_delta(text: str) -> str:
    """Format a text chunk as an OpenAI-compatible SSE delta event."""
    payload = json.dumps({
        'choices': [{
            'delta': {
                'role':    'assistant',
                'content': text,
            },
            'finish_reason': None,
        }]
    })
    return f'data: {payload}\n\n'


def _openai_sync_response(text: str):
    """
    Return a non-streaming OpenAI-compatible response.
    Used for fallback / error paths where we have the full text immediately.
    """
    return jsonify({
        'choices': [{
            'message': {
                'role':    'assistant',
                'content': text,
            },
            'finish_reason': 'stop',
        }]
    })


def _openai_error_response(message: str):
    """Return an OpenAI-compatible error body."""
    return jsonify({'error': {'message': message, 'type': 'invalid_request_error'}})
