"""
Supertonic ONNX TTS provider wrapper.

Wraps the existing tts_providers/supertonic_provider.py to conform to the
unified providers.tts.base.TTSProvider interface (ADR-003).
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from providers.tts.base import TTSError, TTSProvider
from providers.registry import ProviderType, registry

logger = logging.getLogger(__name__)


class SupertonicProvider(TTSProvider):
    """Supertonic local ONNX TTS provider."""

    def __init__(self, config: Dict[str, Any] = None) -> None:
        super().__init__(config)
        import os
        self.onnx_dir = self._config.get("onnx_dir", os.environ.get("SUPERTONIC_ONNX_DIR", os.path.expanduser("~/supertonic/assets/onnx")))
        self.default_voice = self._config.get("default_voice", "M1")
        self._delegate = None

    def _get_delegate(self):
        """Lazy-load the underlying provider to avoid import-time crashes."""
        if self._delegate is None:
            try:
                from tts_providers.supertonic_provider import SupertonicProvider as _Impl  # type: ignore
                self._delegate = _Impl()
            except Exception as exc:
                raise TTSError("supertonic", f"Failed to load Supertonic: {exc}") from exc
        return self._delegate

    def generate_speech(self, text: str, **kwargs) -> bytes:
        self.validate_text(text)
        voice = kwargs.get("voice", self.default_voice)
        try:
            return self._get_delegate().generate_speech(text, voice=voice, **kwargs)
        except Exception as exc:
            raise TTSError("supertonic", f"Generation failed: {exc}") from exc

    def list_voices(self) -> List[str]:
        try:
            return self._get_delegate().list_voices()
        except Exception:
            return [self.default_voice]

    def is_available(self) -> bool:
        try:
            from tts_providers.supertonic_provider import SupertonicProvider as _Impl  # type: ignore
            instance = _Impl()
            return instance.is_available()
        except Exception:
            return False

    def get_info(self) -> Dict[str, Any]:
        return {
            "name": self._config.get("name", "Supertonic ONNX"),
            "status": "active" if self.is_available() else "inactive",
            "onnx_dir": self.onnx_dir,
            "default_voice": self.default_voice,
            "available": self.is_available(),
        }


# Auto-register when this module is imported
registry.register(ProviderType.TTS, "supertonic", SupertonicProvider)
