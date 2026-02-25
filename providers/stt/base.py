"""
STT provider abstract base class.

Based on: future-dev-plans/02-PROVIDER-SYSTEMS.md (stt_providers/base.py section)
ADR-003: Abstract base class + registry pattern.
"""

from abc import abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from providers.base import BaseProvider, ProviderError


@dataclass
class TranscriptionResult:
    text: str
    confidence: float = 0.0
    language: str = "en"
    duration_ms: float = 0.0
    provider: str = ""
    segments: Optional[List[Dict]] = field(default=None)


class STTProvider(BaseProvider):
    """Abstract base class for STT providers (WebSpeech, Whisper, Deepgram, etc.)."""

    @abstractmethod
    def transcribe(
        self,
        audio_data: bytes,
        language: Optional[str] = None,
        **kwargs,
    ) -> TranscriptionResult:
        """Transcribe audio bytes to text."""
        pass

    def list_languages(self) -> List[str]:
        return self._config.get("languages", ["en-US"])

    def is_available(self) -> bool:
        return self.get_info().get("status", "inactive") == "active"

    def get_info(self) -> Dict[str, Any]:
        return {
            "name": self._config.get("name", self.__class__.__name__),
            "languages": self.list_languages(),
            "available": self.is_available(),
            "status": "active",
        }


class STTError(ProviderError):
    """STT-specific provider error."""
    pass


__all__ = ["STTProvider", "TranscriptionResult", "STTError"]
