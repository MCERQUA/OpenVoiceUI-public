"""
Web Speech API STT provider (browser-side stub).

Ref: future-dev-plans/02-PROVIDER-SYSTEMS.md (WebSpeechProvider section)
The actual recognition runs in the browser; this is the server-side registry entry
so profiles can reference 'webspeech' as their STT provider.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from providers.stt.base import STTError, STTProvider, TranscriptionResult
from providers.registry import ProviderType, registry


class WebSpeechProvider(STTProvider):
    """Browser Web Speech API — server-side stub only."""

    def transcribe(
        self,
        audio_data: bytes,
        language: Optional[str] = None,
        **kwargs,
    ) -> TranscriptionResult:
        raise STTError(
            "webspeech",
            "WebSpeech API runs in the browser. Server-side transcription is not supported.",
        )

    def is_available(self) -> bool:
        # Always "available" as it's a browser-side component
        return True

    def list_languages(self) -> List[str]:
        return ["en-US", "en-GB", "es-ES", "fr-FR", "de-DE", "ja-JP", "zh-CN"]

    def get_info(self) -> Dict[str, Any]:
        return {
            "name": self._config.get("name", "Web Speech API"),
            "type": "browser",
            "status": "active",
            "languages": self.list_languages(),
            "available": True,
        }


# Auto-register when this module is imported
registry.register(ProviderType.STT, "webspeech", WebSpeechProvider)
