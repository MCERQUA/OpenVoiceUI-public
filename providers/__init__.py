"""
Provider package — ADR-003: Abstract base class + registry pattern.

Sub-packages:
  providers.llm      — LLMProvider base class + concrete providers
  providers.tts      — TTSProvider base class + concrete providers
  providers.stt      — STTProvider base class + concrete providers
  providers.registry — ProviderRegistry singleton (P5-T2)
"""

from providers.base import (
    BaseProvider,
    ProviderError,
    ProviderUnavailableError,
    ProviderGenerationError,
)
from providers.registry import (
    ProviderRegistry,
    ProviderType,
    registry,
    get_llm_provider,
    get_tts_provider,
    get_stt_provider,
)

__all__ = [
    # Base classes
    "BaseProvider",
    "ProviderError",
    "ProviderUnavailableError",
    "ProviderGenerationError",
    # Registry
    "ProviderRegistry",
    "ProviderType",
    "registry",
    "get_llm_provider",
    "get_tts_provider",
    "get_stt_provider",
]
