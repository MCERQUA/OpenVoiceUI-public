"""
Provider registry with singleton pattern and auto-discovery.

P5-T2: Provider registry + auto-discovery
ADR-003: Abstract base class + registry pattern
Ref: future-dev-plans/02-PROVIDER-SYSTEMS.md (PluginRegistry section)

Usage:
    from providers.registry import registry, ProviderType

    # Register a provider
    registry.register(ProviderType.TTS, 'supertonic', SupertonicProvider)

    # Get a provider instance
    tts = registry.get_provider(ProviderType.TTS)          # default
    tts = registry.get_provider(ProviderType.TTS, 'groq')  # specific

    # List available providers
    providers = registry.list_providers(ProviderType.TTS)
"""

from __future__ import annotations

import importlib
import logging
import os
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Type

logger = logging.getLogger(__name__)


class ProviderType(Enum):
    LLM = "llm"
    TTS = "tts"
    STT = "stt"


class ProviderRegistry:
    """Singleton registry for all provider types (LLM, TTS, STT).

    Providers are registered with a unique string ID per type.
    get_provider() returns an instantiated provider with config merged from
    the providers YAML (if loaded) and any explicit config passed at
    register() time.
    """

    _instance: Optional["ProviderRegistry"] = None

    def __init__(self) -> None:
        self._providers: Dict[ProviderType, Dict[str, Type]] = {
            ProviderType.LLM: {},
            ProviderType.TTS: {},
            ProviderType.STT: {},
        }
        # Static config passed at register() time
        self._static_configs: Dict[str, Dict] = {}
        # YAML config loaded lazily
        self._yaml_config: Optional[Dict] = None

    # ------------------------------------------------------------------
    # Singleton
    # ------------------------------------------------------------------

    @classmethod
    def get_instance(cls) -> "ProviderRegistry":
        if cls._instance is None:
            cls._instance = ProviderRegistry()
        return cls._instance

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(
        self,
        provider_type: ProviderType,
        provider_id: str,
        provider_class: Type,
        config: Optional[Dict] = None,
    ) -> None:
        """Register a provider implementation.

        Args:
            provider_type: LLM, TTS, or STT.
            provider_id:   Unique string key (e.g. 'supertonic', 'zai').
            provider_class: Class (not instance) implementing the base type.
            config:         Optional static config dict merged with YAML config.
        """
        self._providers[provider_type][provider_id] = provider_class
        if config:
            self._static_configs[provider_id] = config
        logger.debug("Registered %s provider: %s", provider_type.value, provider_id)

    # ------------------------------------------------------------------
    # Retrieval
    # ------------------------------------------------------------------

    def get_provider(
        self,
        provider_type: ProviderType,
        provider_id: Optional[str] = None,
    ) -> Any:
        """Return an instantiated provider.

        If provider_id is None, the default is read from providers YAML
        (<type>.default_provider) or falls back to the first registered
        provider for that type.

        Config is merged: static config (register-time) is the base,
        YAML config overrides it.

        Raises:
            ValueError: if the provider_id is not registered.
        """
        if provider_id is None:
            provider_id = self._get_default_id(provider_type)

        if provider_id not in self._providers[provider_type]:
            available = list(self._providers[provider_type].keys())
            raise ValueError(
                f"Unknown {provider_type.value} provider: '{provider_id}'. "
                f"Available: {available}"
            )

        provider_class = self._providers[provider_type][provider_id]
        merged_config = self._build_config(provider_type, provider_id)

        return provider_class(merged_config)

    def list_providers(
        self,
        provider_type: ProviderType,
        include_unavailable: bool = False,
    ) -> List[Dict]:
        """Return a sorted list of provider metadata dicts.

        Each dict has keys: id, name, available, priority, info.
        Sorted ascending by priority (lower number = higher priority).
        """
        results = []
        for pid, provider_class in self._providers[provider_type].items():
            config = self._build_config(provider_type, pid)
            try:
                instance = provider_class(config)
                available = instance.is_available()
                info = instance.get_info()
            except Exception as exc:
                logger.warning("Error probing provider %s: %s", pid, exc)
                available = False
                info = {"name": pid, "status": "error"}

            if include_unavailable or available:
                results.append(
                    {
                        "id": pid,
                        "name": info.get("name", pid),
                        "available": available,
                        "priority": config.get("priority", 100),
                        "info": info,
                    }
                )

        return sorted(results, key=lambda p: p["priority"])

    # ------------------------------------------------------------------
    # Auto-discovery
    # ------------------------------------------------------------------

    def autodiscover(self, providers_yaml_path: Optional[str] = None) -> None:
        """Load providers.yaml and import/register configured providers.

        This is the auto-discovery mechanism: the YAML file declares which
        provider modules to load, and this method imports them so their
        __init__.py register() calls fire automatically.

        If providers_yaml_path is None, defaults to config/providers.yaml
        relative to the project root (detected from this file's location).
        """
        if providers_yaml_path is None:
            providers_yaml_path = self._default_yaml_path()

        try:
            import yaml  # type: ignore
        except ImportError:
            logger.warning("PyYAML not installed — skipping autodiscover")
            return

        path = Path(providers_yaml_path)
        if not path.exists():
            logger.debug("providers.yaml not found at %s — skipping autodiscover", path)
            return

        with open(path) as f:
            self._yaml_config = yaml.safe_load(f) or {}

        logger.info("Loaded providers config from %s", path)

        # Import each provider sub-package so their register() calls fire.
        # The 'modules' key in each provider type section lists module paths.
        for ptype_str in ("llm", "tts", "stt"):
            section = self._yaml_config.get(ptype_str, {})
            for module_path in section.get("modules", []):
                try:
                    importlib.import_module(module_path)
                    logger.debug("Auto-imported provider module: %s", module_path)
                except ImportError as exc:
                    logger.warning("Could not import provider module %s: %s", module_path, exc)

    # ------------------------------------------------------------------
    # Introspection helpers
    # ------------------------------------------------------------------

    def registered_ids(self, provider_type: ProviderType) -> List[str]:
        """Return list of registered provider IDs for a type."""
        return list(self._providers[provider_type].keys())

    def is_registered(self, provider_type: ProviderType, provider_id: str) -> bool:
        return provider_id in self._providers[provider_type]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_default_id(self, provider_type: ProviderType) -> str:
        """Determine the default provider ID for a type."""
        # 1. Try YAML config
        if self._yaml_config:
            section = self._yaml_config.get(provider_type.value, {})
            default = section.get("default_provider")
            if default and default in self._providers[provider_type]:
                return default

        # 2. Fall back to first registered
        registered = list(self._providers[provider_type].keys())
        if registered:
            return registered[0]

        raise ValueError(
            f"No {provider_type.value} providers registered. "
            "Call registry.register() or registry.autodiscover() first."
        )

    def _build_config(self, provider_type: ProviderType, provider_id: str) -> Dict:
        """Merge static + YAML config for a provider ID."""
        # Start with static config (registered at register() time)
        config = dict(self._static_configs.get(provider_id, {}))

        # Layer YAML config on top
        if self._yaml_config:
            section = self._yaml_config.get(provider_type.value, {})
            yaml_provider_cfg = section.get("providers", {}).get(provider_id, {})
            config.update(yaml_provider_cfg)

        # Resolve ${ENV_VAR} placeholders
        config = _resolve_env_vars(config)

        return config

    def _default_yaml_path(self) -> str:
        """Resolve default config/providers.yaml path from project root."""
        # This file lives at providers/registry.py; project root is one level up.
        project_root = Path(__file__).parent.parent
        return str(project_root / "config" / "providers.yaml")


# ---------------------------------------------------------------------------
# Env-var placeholder resolution
# ---------------------------------------------------------------------------

def _resolve_env_vars(config: Dict) -> Dict:
    """Recursively resolve ${ENV_VAR} placeholders in string config values."""
    import re
    _PLACEHOLDER = re.compile(r"\$\{([A-Z_][A-Z0-9_]*)\}")

    def _resolve(value: Any) -> Any:
        if isinstance(value, str):
            def _sub(m: re.Match) -> str:
                return os.environ.get(m.group(1), m.group(0))
            return _PLACEHOLDER.sub(_sub, value)
        if isinstance(value, dict):
            return {k: _resolve(v) for k, v in value.items()}
        if isinstance(value, list):
            return [_resolve(v) for v in value]
        return value

    return _resolve(config)


# ---------------------------------------------------------------------------
# Module-level singleton + convenience aliases
# ---------------------------------------------------------------------------

registry = ProviderRegistry.get_instance()


def get_llm_provider(provider_id: Optional[str] = None) -> Any:
    """Convenience: get an LLM provider instance."""
    return registry.get_provider(ProviderType.LLM, provider_id)


def get_tts_provider(provider_id: Optional[str] = None) -> Any:
    """Convenience: get a TTS provider instance."""
    return registry.get_provider(ProviderType.TTS, provider_id)


def get_stt_provider(provider_id: Optional[str] = None) -> Any:
    """Convenience: get an STT provider instance."""
    return registry.get_provider(ProviderType.STT, provider_id)


__all__ = [
    "ProviderType",
    "ProviderRegistry",
    "registry",
    "get_llm_provider",
    "get_tts_provider",
    "get_stt_provider",
]
