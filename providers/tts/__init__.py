"""TTS provider package.

Importing this package registers all TTS providers with the registry.
"""

from providers.tts.base import TTSProvider, TTSVoice, TTSError, TTSVoiceNotFoundError

# Import concrete providers so their registry.register() calls fire
from providers.tts import supertonic_provider  # noqa: F401
from providers.tts import groq_provider  # noqa: F401

__all__ = ["TTSProvider", "TTSVoice", "TTSError", "TTSVoiceNotFoundError"]
