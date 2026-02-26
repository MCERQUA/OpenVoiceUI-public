"""
Gateway implementations for OpenVoiceUI.

Built-in:
  openclaw  — OpenClaw persistent WebSocket gateway (default)

Plugins (drop into plugins/<id>/gateway.py):
  See plugins/README.md for the contributor guide.
"""
from services.gateways.base import GatewayBase

__all__ = ['GatewayBase']
