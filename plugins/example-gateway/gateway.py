"""
Example gateway plugin — echoes messages back.

This is the reference implementation for building OpenVoiceUI gateway plugins.
Copy this directory, rename it, and implement your LLM backend.

To use this gateway:
  1. Add plugin.json (already done here)
  2. Implement stream_to_queue() below
  3. Add a profile that routes to it:

     profiles/my-profile.json:
       {
         "adapter_config": {
           "gateway_id": "example-gateway",
           "sessionKey": "example-1"
         }
       }

  4. Restart the server — it auto-discovers plugins/ on startup.
"""

import os
import queue
import time

from services.gateways.base import GatewayBase


class Gateway(GatewayBase):
    """
    Echo gateway — returns the user's message back as the AI response.
    Replace the stream_to_queue() body with your actual LLM integration.
    """

    gateway_id = "example-gateway"
    persistent = False   # REST/stateless — set True if you maintain a connection

    def is_configured(self) -> bool:
        # Return True if your required env vars are set.
        # Example: return bool(os.getenv("MY_API_KEY"))
        return True   # echo needs no config

    def stream_to_queue(
        self,
        event_queue: queue.Queue,
        message: str,
        session_key: str,
        captured_actions=None,
        **kwargs,
    ) -> None:
        """
        Send message to your LLM and stream events into event_queue.

        Required events:
          1. (optional) {'type': 'handshake', 'ms': int}
          2. One or more {'type': 'delta', 'text': str}   ← streaming tokens
          3. Exactly one {'type': 'text_done', 'response': str, 'actions': list}
             OR on failure: {'type': 'error', 'error': str}

        This example just echoes the message back word-by-word.
        Replace with your actual API calls (Anthropic, OpenAI, LangChain, etc.)
        """
        if captured_actions is None:
            captured_actions = []

        try:
            # --- YOUR LLM CALL GOES HERE ---
            # Example: response = anthropic_client.messages.create(...)

            # Simulate streaming by yielding the echo word by word
            response_text = f"Echo: {message}"
            words = response_text.split()
            for i, word in enumerate(words):
                token = word + (' ' if i < len(words) - 1 else '')
                event_queue.put({'type': 'delta', 'text': token})
                time.sleep(0.05)   # remove this in real implementations

            event_queue.put({
                'type': 'text_done',
                'response': response_text,
                'actions': captured_actions,
            })

        except Exception as exc:
            event_queue.put({'type': 'error', 'error': str(exc)})
