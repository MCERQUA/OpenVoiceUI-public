"""
Backwards-compatibility shim.

The gateway implementation has moved to:
  services/gateways/openclaw.py   — OpenClaw persistent WS gateway
  services/gateway_manager.py     — registry, plugin loader, router

New code should import from gateway_manager:
    from services.gateway_manager import gateway_manager

Existing code that imports gateway_connection continues to work unchanged:
    from services.gateway import gateway_connection
"""
from services.gateway_manager import gateway_manager as gateway_connection

__all__ = ['gateway_connection']
