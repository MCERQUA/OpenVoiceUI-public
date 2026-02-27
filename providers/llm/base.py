"""
LLM provider abstract base class.

Based on: future-dev-plans/02-PROVIDER-SYSTEMS.md (llm_providers/base.py section)
ADR-003: Abstract base class + registry pattern.
"""

from abc import abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional

from providers.base import BaseProvider, ProviderError


@dataclass
class LLMResponse:
    content: str
    model: str
    provider: str
    usage: Dict[str, int] = field(default_factory=dict)
    latency_ms: float = 0.0
    finish_reason: str = "stop"
    raw_response: Any = None


class LLMProvider(BaseProvider):
    """Abstract base class for LLM providers (ZAI, Clawdbot, OpenAI, etc.)."""

    @abstractmethod
    def generate(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        **kwargs,
    ) -> LLMResponse:
        """Generate a complete (non-streaming) response."""
        pass

    @abstractmethod
    def generate_stream(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        **kwargs,
    ) -> Iterator[str]:
        """Generate a streaming response, yielding text chunks."""
        pass

    def list_models(self) -> List[Dict[str, Any]]:
        return self._config.get("models", [])

    def get_default_model(self) -> str:
        return self._config.get("default_model", "default")

    def get_info(self) -> Dict[str, Any]:
        return {
            "name": self._config.get("name", self.__class__.__name__),
            "models": self.list_models(),
            "available": self.is_available(),
            "status": "active" if self.is_available() else "inactive",
        }


class LLMError(ProviderError):
    """LLM-specific provider error."""
    pass


__all__ = ["LLMProvider", "LLMResponse", "LLMError"]
