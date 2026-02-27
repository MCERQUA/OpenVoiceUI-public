"""
Provider abstract base classes — ADR-003: Abstract base class + registry pattern.

All provider types (LLM, TTS, STT) share this common interface contract.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict


class BaseProvider(ABC):
    """Common base for all provider types."""

    def __init__(self, config: Dict[str, Any] = None):
        self._config = config or {}

    @abstractmethod
    def is_available(self) -> bool:
        """Return True if the provider can handle requests right now."""
        pass

    @abstractmethod
    def get_info(self) -> Dict[str, Any]:
        """Return metadata dict with at minimum 'name' and 'status' keys."""
        pass

    def get_config(self, key: str, default: Any = None) -> Any:
        """Safely read a value from the provider config dict."""
        return self._config.get(key, default)

    def __repr__(self) -> str:
        info = self.get_info()
        return (
            f"{self.__class__.__name__}("
            f"name='{info.get('name', 'unknown')}', "
            f"available={self.is_available()})"
        )


class ProviderError(Exception):
    """Base exception for all provider errors."""

    def __init__(self, provider_name: str, message: str):
        self.provider_name = provider_name
        super().__init__(f"[{provider_name}] {message}")


class ProviderUnavailableError(ProviderError):
    """Raised when a provider is not available or not configured."""
    pass


class ProviderGenerationError(ProviderError):
    """Raised when a provider fails during generation/inference."""
    pass


__all__ = [
    "BaseProvider",
    "ProviderError",
    "ProviderUnavailableError",
    "ProviderGenerationError",
]
