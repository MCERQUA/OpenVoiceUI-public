"""
TTS provider abstract base class.

Extends the existing tts_providers/base_provider.py pattern to conform to the
unified BaseProvider interface required by ADR-003.
"""

from abc import abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from providers.base import BaseProvider, ProviderError


@dataclass
class TTSVoice:
    id: str
    name: str
    language: str = "en"
    gender: Optional[str] = None
    description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "language": self.language,
            "gender": self.gender,
            "description": self.description,
        }


class TTSProvider(BaseProvider):
    """Abstract base class for TTS providers (Supertonic, Groq, ElevenLabs, etc.)."""

    @abstractmethod
    def generate_speech(self, text: str, **kwargs) -> bytes:
        """Convert text to audio bytes (WAV or MP3)."""
        pass

    @abstractmethod
    def list_voices(self) -> List[str]:
        """Return list of available voice IDs."""
        pass

    def list_voices_detailed(self) -> List[TTSVoice]:
        """Return TTSVoice objects; override for richer metadata."""
        return [TTSVoice(id=v, name=v) for v in self.list_voices()]

    def get_default_voice(self) -> Optional[str]:
        voices = self.list_voices()
        return voices[0] if voices else None

    def validate_text(self, text: str) -> None:
        if text is None:
            raise ValueError("Text cannot be None")
        if not isinstance(text, str):
            raise ValueError(f"Text must be str, got {type(text).__name__}")
        if not text.strip():
            raise ValueError("Text cannot be empty or whitespace-only")

    def validate_voice(self, voice: str) -> bool:
        return voice in self.list_voices()

    def is_available(self) -> bool:
        return self.get_info().get("status", "inactive") == "active"

    def get_info(self) -> Dict[str, Any]:
        return {
            "name": self._config.get("name", self.__class__.__name__),
            "status": "active",
            "available": True,
        }


class TTSError(ProviderError):
    """TTS-specific provider error."""
    pass


class TTSVoiceNotFoundError(TTSError):
    """Requested voice does not exist in this provider."""
    pass


__all__ = [
    "TTSProvider",
    "TTSVoice",
    "TTSError",
    "TTSVoiceNotFoundError",
]
