"""
Tests for the OpenAI-compatible gateway plugin.

These tests mock the HTTP layer — no API key or live server needed.
"""

import json
import os
import queue
import textwrap
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_sse_chunk(content: str, finish_reason=None):
    """Build one SSE data line from a delta content string."""
    chunk = {
        "id": "chatcmpl-test",
        "object": "chat.completion.chunk",
        "choices": [{
            "index": 0,
            "delta": {"content": content} if content else {},
            "finish_reason": finish_reason,
        }],
    }
    return f"data: {json.dumps(chunk)}"


def _make_sse_stream(tokens: list[str]):
    """Build a full SSE byte stream from a list of token strings."""
    lines = []
    for token in tokens:
        lines.append(_make_sse_chunk(token))
        lines.append("")  # blank line between events
    lines.append("data: [DONE]")
    lines.append("")
    return "\n".join(lines)


def _drain_queue(q: queue.Queue) -> list[dict]:
    """Drain all events from a queue into a list."""
    events = []
    while not q.empty():
        events.append(q.get_nowait())
    return events


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _set_env(monkeypatch):
    """Set required env vars for the gateway."""
    monkeypatch.setenv("OPENAI_COMPAT_API_KEY", "sk-test-key-12345")
    monkeypatch.setenv("OPENAI_COMPAT_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("OPENAI_COMPAT_MODEL", "gpt-4o-mini")


@pytest.fixture
def gateway():
    """Fresh gateway instance (re-reads env on each test)."""
    # Need to import after env is set
    import importlib
    import sys
    # Remove cached module if any
    mod_name = "plugins.openai-compat.gateway"
    if mod_name in sys.modules:
        del sys.modules[mod_name]

    # Import directly from file path
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location(
        "openai_compat_gateway",
        Path(__file__).parent.parent / "plugins" / "openai-compat" / "gateway.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    # Clear session history between tests
    module._sessions.clear()

    return module.Gateway()


# ---------------------------------------------------------------------------
# Tests — Configuration
# ---------------------------------------------------------------------------

class TestConfiguration:
    def test_is_configured_with_key(self, gateway):
        assert gateway.is_configured() is True

    def test_is_configured_without_key(self, monkeypatch):
        monkeypatch.setenv("OPENAI_COMPAT_API_KEY", "")
        import importlib.util
        from pathlib import Path
        spec = importlib.util.spec_from_file_location(
            "openai_compat_gw_nokey",
            Path(__file__).parent.parent / "plugins" / "openai-compat" / "gateway.py",
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        gw = module.Gateway()
        assert gw.is_configured() is False

    def test_gateway_id(self, gateway):
        assert gateway.gateway_id == "openai-compat"

    def test_not_persistent(self, gateway):
        assert gateway.persistent is False

    def test_custom_base_url(self, monkeypatch):
        monkeypatch.setenv("OPENAI_COMPAT_BASE_URL", "http://localhost:8000/v1")
        import importlib.util
        from pathlib import Path
        spec = importlib.util.spec_from_file_location(
            "openai_compat_gw_custom",
            Path(__file__).parent.parent / "plugins" / "openai-compat" / "gateway.py",
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        gw = module.Gateway()
        assert gw._base_url == "http://localhost:8000/v1"


# ---------------------------------------------------------------------------
# Tests — Streaming
# ---------------------------------------------------------------------------

class TestStreaming:
    @patch("requests.post")
    def test_basic_stream(self, mock_post, gateway):
        """Happy path: stream 3 tokens and verify events."""
        tokens = ["Hello", " world", "!"]
        sse_text = _make_sse_stream(tokens)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.iter_lines.return_value = iter(sse_text.split("\n"))
        mock_post.return_value = mock_response

        q = queue.Queue()
        gateway.stream_to_queue(q, "Hi", "test-session-1")

        events = _drain_queue(q)
        types = [e["type"] for e in events]

        assert "handshake" in types
        assert "text_done" in types

        deltas = [e for e in events if e["type"] == "delta"]
        assert len(deltas) == 3
        assert deltas[0]["text"] == "Hello"
        assert deltas[1]["text"] == " world"
        assert deltas[2]["text"] == "!"

        text_done = next(e for e in events if e["type"] == "text_done")
        assert text_done["response"] == "Hello world!"

    @patch("requests.post")
    def test_empty_response(self, mock_post, gateway):
        """LLM returns no content — text_done with response=None."""
        sse_text = "data: [DONE]\n"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.iter_lines.return_value = iter(sse_text.split("\n"))
        mock_post.return_value = mock_response

        q = queue.Queue()
        gateway.stream_to_queue(q, "Hi", "test-session-2")

        events = _drain_queue(q)
        text_done = next(e for e in events if e["type"] == "text_done")
        assert text_done["response"] is None

    @patch("requests.post")
    def test_api_error_status(self, mock_post, gateway):
        """Non-200 status code produces an error event."""
        mock_response = MagicMock()
        mock_response.status_code = 429
        mock_response.text = "Rate limit exceeded"
        mock_post.return_value = mock_response

        q = queue.Queue()
        gateway.stream_to_queue(q, "Hi", "test-session-3")

        events = _drain_queue(q)
        assert any(e["type"] == "error" for e in events)
        error = next(e for e in events if e["type"] == "error")
        assert "429" in error["error"]

    @patch("requests.post")
    def test_connection_error(self, mock_post, gateway):
        """Connection failure produces an error event."""
        mock_post.side_effect = Exception("Connection refused")

        q = queue.Queue()
        gateway.stream_to_queue(q, "Hi", "test-session-4")

        events = _drain_queue(q)
        assert any(e["type"] == "error" for e in events)

    @patch("requests.post")
    def test_timeout(self, mock_post, gateway):
        """Request timeout produces an error event."""
        import requests as req_lib
        mock_post.side_effect = req_lib.exceptions.Timeout("timed out")

        q = queue.Queue()
        gateway.stream_to_queue(q, "Hi", "test-session-5")

        events = _drain_queue(q)
        assert any(e["type"] == "error" for e in events)
        error = next(e for e in events if e["type"] == "error")
        assert "timed out" in error["error"].lower()


# ---------------------------------------------------------------------------
# Tests — Conversation Memory
# ---------------------------------------------------------------------------

class TestConversationMemory:
    @patch("requests.post")
    def test_history_accumulates(self, mock_post, gateway):
        """Second request includes the first exchange in messages."""
        tokens = ["Hi", " there"]
        sse_text = _make_sse_stream(tokens)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.iter_lines.return_value = iter(sse_text.split("\n"))
        mock_post.return_value = mock_response

        q = queue.Queue()
        gateway.stream_to_queue(q, "Hello", "memory-session")

        # Second request
        mock_response2 = MagicMock()
        mock_response2.status_code = 200
        mock_response2.iter_lines.return_value = iter(_make_sse_stream(["Ok"]).split("\n"))
        mock_post.return_value = mock_response2

        q2 = queue.Queue()
        gateway.stream_to_queue(q2, "How are you?", "memory-session")

        # Check the second call's messages array
        call_args = mock_post.call_args_list[1]
        sent_payload = call_args[1]["json"]
        messages = sent_payload["messages"]

        # Should have: system + user("Hello") + assistant("Hi there") + user("How are you?")
        roles = [m["role"] for m in messages]
        assert "user" in roles
        assert "assistant" in roles

    @patch("requests.post")
    def test_separate_sessions(self, mock_post, gateway):
        """Different session keys have independent histories."""
        sse_text = _make_sse_stream(["A"])

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.iter_lines.return_value = iter(sse_text.split("\n"))
        mock_post.return_value = mock_response

        q = queue.Queue()
        gateway.stream_to_queue(q, "First", "session-a")

        mock_response2 = MagicMock()
        mock_response2.status_code = 200
        mock_response2.iter_lines.return_value = iter(_make_sse_stream(["B"]).split("\n"))
        mock_post.return_value = mock_response2

        q2 = queue.Queue()
        gateway.stream_to_queue(q2, "Second", "session-b")

        # Second call (session-b) should NOT include "First" in messages
        call_args = mock_post.call_args_list[1]
        sent_payload = call_args[1]["json"]
        messages_content = [m["content"] for m in sent_payload["messages"]]
        assert "First" not in messages_content


# ---------------------------------------------------------------------------
# Tests — Request format
# ---------------------------------------------------------------------------

class TestRequestFormat:
    @patch("requests.post")
    def test_sends_correct_url(self, mock_post, gateway):
        """Requests go to {base_url}/chat/completions."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.iter_lines.return_value = iter("data: [DONE]\n".split("\n"))
        mock_post.return_value = mock_response

        q = queue.Queue()
        gateway.stream_to_queue(q, "test", "s1")

        url = mock_post.call_args[0][0]
        assert url == "https://api.openai.com/v1/chat/completions"

    @patch("requests.post")
    def test_sends_auth_header(self, mock_post, gateway):
        """Authorization header contains the API key."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.iter_lines.return_value = iter("data: [DONE]\n".split("\n"))
        mock_post.return_value = mock_response

        q = queue.Queue()
        gateway.stream_to_queue(q, "test", "s1")

        headers = mock_post.call_args[1]["headers"]
        assert headers["Authorization"] == "Bearer sk-test-key-12345"

    @patch("requests.post")
    def test_sends_streaming_true(self, mock_post, gateway):
        """Request payload has stream=True."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.iter_lines.return_value = iter("data: [DONE]\n".split("\n"))
        mock_post.return_value = mock_response

        q = queue.Queue()
        gateway.stream_to_queue(q, "test", "s1")

        payload = mock_post.call_args[1]["json"]
        assert payload["stream"] is True
        assert payload["model"] == "gpt-4o-mini"
