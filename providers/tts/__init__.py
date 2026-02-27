"""TTS provider package — adapter layer.

Architecture note:
  - tts_providers/  ← canonical implementation (add new providers here)
  - providers/tts/  ← adapter wrappers used by the registry system and tests
                       These delegate to tts_providers/ for actual TTS work.

To add a new TTS provider:
  1. Create tts_providers/myprovider_provider.py  (inheriting TTSProvider from tts_providers/base_provider.py)
  2. Register it in tts_providers/__init__.py _PROVIDERS dict
  3. Add metadata to tts_providers/providers_config.json
"""

from providers.tts.base import TTSProvider, TTSVoice, TTSError, TTSVoiceNotFoundError

# Import concrete providers so their registry.register() calls fire
from providers.tts import supertonic_provider  # noqa: F401
from providers.tts import groq_provider  # noqa: F401

__all__ = ["TTSProvider", "TTSVoice", "TTSError", "TTSVoiceNotFoundError"]
