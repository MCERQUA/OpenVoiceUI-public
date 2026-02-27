"""
OpenAI-Compatible Gateway Plugin for OpenVoiceUI.

Connects to any endpoint that implements the OpenAI Chat Completions API:
  - OpenAI (api.openai.com)
  - Groq (api.groq.com/openai)
  - Together (api.together.xyz)
  - Fireworks (api.fireworks.ai)
  - vLLM / TGI / LiteLLM (any local server)
  - Ollama with /v1 prefix

Environment variables:
  OPENAI_COMPAT_API_KEY    — API key (required)
  OPENAI_COMPAT_BASE_URL   — Base URL (default: https://api.openai.com/v1)
  OPENAI_COMPAT_MODEL      — Model ID (default: gpt-4o-mini)
  OPENAI_COMPAT_MAX_TOKENS — Max response tokens (default: 1024)

Usage in a profile:
  {
    "adapter_config": {
      "gateway_id": "openai-compat",
      "sessionKey": "openai-1"
    }
  }
"""

import json
import logging
import os
import queue
import time
from typing import Optional

import requests

from services.gateways.base import GatewayBase

logger = logging.getLogger(__name__)

# In-memory conversation history per session key.
# Keeps the last N messages so the LLM has context across turns.
_MAX_HISTORY = 20
_sessions: dict[str, list[dict]] = {}


def _get_history(session_key: str) -> list[dict]:
    """Return the conversation history for a session, creating if needed."""
    if session_key not in _sessions:
        _sessions[session_key] = []
    return _sessions[session_key]


def _trim_history(history: list[dict]) -> None:
    """Keep only the last _MAX_HISTORY messages (in-place)."""
    while len(history) > _MAX_HISTORY:
        history.pop(0)


class Gateway(GatewayBase):
    """
    OpenAI-compatible Chat Completions gateway.

    Streams tokens via the standard SSE streaming protocol and maps them
    to OpenVoiceUI's event queue format.
    """

    gateway_id = "openai-compat"
    persistent = False  # Stateless REST — connect per request

    def __init__(self):
        self._api_key = os.getenv("OPENAI_COMPAT_API_KEY", "")
        self._base_url = os.getenv(
            "OPENAI_COMPAT_BASE_URL", "https://api.openai.com/v1"
        ).rstrip("/")
        self._model = os.getenv("OPENAI_COMPAT_MODEL", "gpt-4o-mini")
        self._max_tokens = int(os.getenv("OPENAI_COMPAT_MAX_TOKENS", "1024"))

    def is_configured(self) -> bool:
        return bool(self._api_key)

    def stream_to_queue(
        self,
        event_queue: queue.Queue,
        message: str,
        session_key: str,
        captured_actions: Optional[list] = None,
        **kwargs,
    ) -> None:
        """
        Send a message to the OpenAI-compatible endpoint with streaming
        and push delta/text_done/error events into event_queue.
        """
        if captured_actions is None:
            captured_actions = []

        history = _get_history(session_key)

        # Load system prompt from the hot-reload file if available
        system_prompt = self._load_system_prompt()

        # Build the messages array
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.extend(history)
        messages.append({"role": "user", "content": message})

        # Record user message in history
        history.append({"role": "user", "content": message})
        _trim_history(history)

        url = f"{self._base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        payload = {
            "model": self._model,
            "messages": messages,
            "max_tokens": self._max_tokens,
            "stream": True,
        }

        t_start = time.time()
        full_response = []

        try:
            response = requests.post(
                url,
                headers=headers,
                json=payload,
                stream=True,
                timeout=120,
            )

            if response.status_code != 200:
                error_body = response.text[:500]
                err = (
                    f"OpenAI-compat API error {response.status_code}: {error_body}"
                )
                logger.error(err)
                event_queue.put({"type": "error", "error": err})
                return

            # Report handshake latency (time to first byte)
            t_first_byte = time.time()
            event_queue.put({
                "type": "handshake",
                "ms": int((t_first_byte - t_start) * 1000),
            })

            # Parse SSE stream
            for line in response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                if not line.startswith("data: "):
                    continue

                data_str = line[6:]  # strip "data: " prefix
                if data_str.strip() == "[DONE]":
                    break

                try:
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    logger.debug(f"Skipping non-JSON SSE line: {data_str[:100]}")
                    continue

                # Extract the delta content
                choices = chunk.get("choices", [])
                if not choices:
                    continue

                delta = choices[0].get("delta", {})
                content = delta.get("content")
                if content:
                    full_response.append(content)
                    event_queue.put({"type": "delta", "text": content})

                # Check for finish_reason
                finish = choices[0].get("finish_reason")
                if finish:
                    break

            # Assemble the complete response
            response_text = "".join(full_response)

            # Record assistant response in history
            if response_text:
                history.append({"role": "assistant", "content": response_text})
                _trim_history(history)

            event_queue.put({
                "type": "text_done",
                "response": response_text or None,
                "actions": captured_actions,
                "timing": {
                    "total_ms": int((time.time() - t_start) * 1000),
                },
            })

        except requests.exceptions.Timeout:
            err = f"OpenAI-compat request timed out after 120s ({self._base_url})"
            logger.error(err)
            event_queue.put({"type": "error", "error": err})
        except requests.exceptions.ConnectionError as e:
            err = f"Cannot connect to {self._base_url}: {e}"
            logger.error(err)
            event_queue.put({"type": "error", "error": err})
        except Exception as e:
            err = f"OpenAI-compat gateway error: {e}"
            logger.error(err)
            event_queue.put({"type": "error", "error": err})

    def _load_system_prompt(self) -> str:
        """Load the hot-reload system prompt from prompts/voice-system-prompt.md."""
        try:
            prompt_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "prompts",
                "voice-system-prompt.md",
            )
            if not os.path.exists(prompt_path):
                return ""
            with open(prompt_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            # Strip comment lines (starting with #) per OpenVoiceUI convention
            content = "".join(
                line for line in lines if not line.strip().startswith("#")
            ).strip()
            return content
        except Exception as e:
            logger.warning(f"Could not load system prompt: {e}")
            return ""
