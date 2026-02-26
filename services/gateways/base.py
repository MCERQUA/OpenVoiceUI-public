"""
GatewayBase — abstract interface all gateway implementations must satisfy.

A gateway is the backend LLM connection: it receives a user message and
streams response events into a queue that conversation.py consumes.

Built-in implementation: services/gateways/openclaw.py
Plugin implementations:  plugins/<id>/gateway.py  (see plugins/README.md)

Implementing a gateway
----------------------
1. Subclass GatewayBase
2. Set gateway_id (unique string slug, e.g. "claude-api")
3. Set persistent = True if you maintain a live connection (WS, gRPC, etc.)
   Set persistent = False if you connect on each request (REST APIs)
4. Implement is_configured(), stream_to_queue()
5. Optionally override is_healthy() for a richer health check

Event protocol
--------------
stream_to_queue() must put dicts onto event_queue in this order:

  {'type': 'handshake', 'ms': int}           optional — connection latency
  {'type': 'delta', 'text': str}             one or more streaming tokens
  {'type': 'action', 'action': dict}         tool calls / lifecycle events
  {'type': 'text_done',                      final — MUST always be sent
   'response': str | None,
   'actions': list}
  {'type': 'error', 'error': str}            on failure instead of text_done
"""

import queue
from typing import Optional


class GatewayBase:
    """Abstract base class for all OpenVoiceUI gateway implementations."""

    # Unique slug used as the routing key in gateway_manager and profiles.
    # Set this on every subclass. Example: "openclaw", "claude-api", "langchain"
    gateway_id: str = "unnamed"

    # True  → maintain a persistent connection (WS, long-lived thread, etc.)
    #         gateway_manager will call is_healthy() on startup to warm it up.
    # False → connect per-request (REST APIs, stateless clients)
    #         zero idle cost; no background thread required.
    persistent: bool = False

    # ------------------------------------------------------------------ #
    # Required — subclasses must implement these                          #
    # ------------------------------------------------------------------ #

    def is_configured(self) -> bool:
        """
        Return True if all required env vars / config are present.
        Called on startup. If False, gateway is registered but marked inactive
        and a warning is logged. Requests routed to it will return an error.
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} must implement is_configured()"
        )

    def stream_to_queue(
        self,
        event_queue: queue.Queue,
        message: str,
        session_key: str,
        captured_actions: Optional[list] = None,
        **kwargs,
    ) -> None:
        """
        Send message to the LLM backend and stream response events into
        event_queue. This method is blocking — it returns when the full
        response is done (or on error).

        Called from a background thread by conversation.py.

        Args:
            event_queue:      thread-safe queue.Queue for yielded events
            message:          user message string (already context-enriched)
            session_key:      session identifier for conversational memory
            captured_actions: list to append tool/lifecycle events to
            **kwargs:         gateway-specific extras (e.g. agent_id for openclaw)
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} must implement stream_to_queue()"
        )

    # ------------------------------------------------------------------ #
    # Optional — override for richer behaviour                            #
    # ------------------------------------------------------------------ #

    def is_healthy(self) -> bool:
        """
        Quick synchronous health check. No I/O — just inspect local state.
        Default: same as is_configured().
        Override to check live connection state, last-error timestamp, etc.
        """
        return self.is_configured()

    def shutdown(self) -> None:
        """
        Called when the server shuts down. Override to close connections,
        cancel background threads, etc. Default: no-op.
        """

    def __repr__(self) -> str:
        status = "configured" if self.is_configured() else "not configured"
        kind = "persistent" if self.persistent else "on-demand"
        return f"<{self.__class__.__name__} id={self.gateway_id!r} {kind} {status}>"
