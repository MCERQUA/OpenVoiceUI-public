"""
services/speech_normalizer.py — Speech Normalization Service

Cleans and normalizes LLM response text before it is sent to TTS providers.
Rules are loaded from config/speech_normalization.yaml (ADR-001).

Usage:
    from services.speech_normalizer import SpeechNormalizer

    normalizer = SpeechNormalizer()
    clean_text = normalizer.normalize("Hello **world**! Check https://example.com", profile_id="default")

The normalizer supports per-profile rule overrides defined in
config/speech_normalization.yaml under the `profiles:` key.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Config file location (relative to project root)
_DEFAULT_CONFIG_PATH = Path(__file__).parent.parent / "config" / "speech_normalization.yaml"


class SpeechNormalizer:
    """
    Normalizes text for TTS by applying a configurable pipeline of rules:

    1. Strip markdown formatting (headers, bold, code blocks, etc.)
    2. Strip URLs
    3. Strip emoji
    4. Expand abbreviations (API → A P I, etc.)
    5. Collapse whitespace
    6. Trim to max_length

    Rules are loaded from speech_normalization.yaml.
    Per-profile overrides are merged on top of global defaults.
    """

    def __init__(self, config_path: Optional[str] = None) -> None:
        self._config_path = Path(config_path) if config_path else _DEFAULT_CONFIG_PATH
        self._raw_config: Dict[str, Any] = {}
        self._global: Dict[str, Any] = {}
        self._profile_overrides: Dict[str, Dict[str, Any]] = {}
        self._load_config()

    # ── Config loading ─────────────────────────────────────────────────────────

    def _load_config(self) -> None:
        """Load and parse speech_normalization.yaml."""
        if not self._config_path.exists():
            logger.warning(
                "Speech normalization config not found at %s — using built-in defaults",
                self._config_path,
            )
            self._raw_config = {}
            self._global = self._builtin_defaults()
            return

        try:
            import yaml  # type: ignore
            with open(self._config_path, "r") as f:
                self._raw_config = yaml.safe_load(f) or {}
            self._global = {**self._builtin_defaults(), **self._raw_config.get("global", {})}
            # Merge global abbreviations with per-section ones
            global_abbrevs = self._raw_config.get("abbreviations", {})
            self._global["_abbreviations"] = global_abbrevs
            # Per-profile overrides
            self._profile_overrides = self._raw_config.get("profiles", {})
            logger.info("Speech normalization config loaded from %s", self._config_path)
        except Exception as exc:
            logger.error("Failed to load speech normalization config: %s — using defaults", exc)
            self._global = self._builtin_defaults()
            self._global["_abbreviations"] = {}

    def _builtin_defaults(self) -> Dict[str, Any]:
        """Minimal built-in defaults used when config file is absent."""
        return {
            "strip_markdown": True,
            "strip_urls": True,
            "strip_emoji": True,
            "collapse_whitespace": True,
            "trim": True,
            "max_length": 800,
            "_abbreviations": {},
        }

    def reload(self) -> None:
        """Reload config from disk (e.g. after hot-edit)."""
        self._load_config()
        logger.info("Speech normalization config reloaded")

    # ── Public API ─────────────────────────────────────────────────────────────

    def normalize(self, text: str, profile_id: Optional[str] = None) -> str:
        """
        Apply the full normalization pipeline to *text*.

        Args:
            text: Raw LLM response text.
            profile_id: Optional agent profile ID. If provided, per-profile
                        overrides from speech_normalization.yaml are merged on
                        top of the global settings.

        Returns:
            Cleaned string ready for TTS input.
        """
        if not text:
            return text

        cfg = self._merged_config(profile_id)

        # 1. Strip markdown
        if cfg.get("strip_markdown", True):
            text = self._strip_markdown(text)

        # 2. Strip URLs
        if cfg.get("strip_urls", True):
            text = self._strip_urls(text)

        # 3. Strip emoji
        if cfg.get("strip_emoji", True):
            text = self._strip_emoji(text)

        # 4. Expand abbreviations (global + profile-specific)
        abbreviations = {**self._global.get("_abbreviations", {}), **cfg.get("abbreviations", {})}
        if abbreviations:
            text = self._expand_abbreviations(text, abbreviations)

        # 5. Collapse whitespace
        if cfg.get("collapse_whitespace", True):
            text = re.sub(r"[ \t]+", " ", text)
            text = re.sub(r"\n{2,}", " ", text)
            text = re.sub(r"\n", " ", text)

        # 6. Trim
        if cfg.get("trim", True):
            text = text.strip()

        # 7. Enforce max length (hard cap)
        max_len = cfg.get("max_length", 800)
        if len(text) > max_len:
            # Try to break at a sentence boundary
            cut = text[:max_len].rfind(". ")
            if cut > max_len // 2:
                text = text[: cut + 1]
            else:
                text = text[:max_len].rstrip() + "..."
            logger.debug("Speech normalizer truncated text to %d chars", len(text))

        return text

    def get_config_for_profile(self, profile_id: Optional[str] = None) -> Dict[str, Any]:
        """Return the effective normalized config for a given profile (for inspection/debugging)."""
        return self._merged_config(profile_id)

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _merged_config(self, profile_id: Optional[str]) -> Dict[str, Any]:
        """Merge global settings with per-profile overrides."""
        base = dict(self._global)
        if profile_id and profile_id in self._profile_overrides:
            override = self._profile_overrides[profile_id]
            # Merge abbreviations separately (additive)
            override_abbrevs = override.pop("abbreviations", {}) if isinstance(override, dict) else {}
            base.update(override)
            override["abbreviations"] = override_abbrevs  # restore for future calls
            base["abbreviations"] = override_abbrevs
        return base

    def _strip_markdown(self, text: str) -> str:
        """Remove common markdown syntax from text."""
        patterns = self._raw_config.get("markdown_patterns", [])
        if patterns:
            for entry in patterns:
                raw_pattern = entry.get("pattern", "")
                replacement = entry.get("replacement", "")
                flags_str = entry.get("flags", "")
                flags = 0
                if "multiline" in flags_str:
                    flags |= re.MULTILINE
                try:
                    text = re.sub(raw_pattern, replacement, text, flags=flags)
                except re.error as exc:
                    logger.warning("Invalid markdown pattern %r: %s", raw_pattern, exc)
        else:
            # Built-in fallback patterns when config is absent
            text = re.sub(r"```[\s\S]*?```", "", text)
            text = re.sub(r"`[^`]+`", "", text)
            text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
            text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
            text = re.sub(r"__(.+?)__", r"\1", text)
            text = re.sub(r"\*(.+?)\*", r"\1", text)
            text = re.sub(r"_(.+?)_", r"\1", text)
            text = re.sub(r"~~(.+?)~~", r"\1", text)
            text = re.sub(r"^[-*_]{3,}$", "", text, flags=re.MULTILINE)
            text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
            text = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", text)
            text = re.sub(r"^>\s*", "", text, flags=re.MULTILINE)
            text = re.sub(r"^[\-\*\+]\s+", "", text, flags=re.MULTILINE)
            text = re.sub(r"^\d+\.\s+", "", text, flags=re.MULTILINE)
        return text

    def _strip_urls(self, text: str) -> str:
        """Remove HTTP/HTTPS URLs from text."""
        url_pattern = self._raw_config.get("url_pattern", r"https?://[^\s]+")
        try:
            text = re.sub(url_pattern, "", text)
        except re.error:
            text = re.sub(r"https?://[^\s]+", "", text)
        return text

    def _strip_emoji(self, text: str) -> str:
        """Remove emoji characters from text."""
        # Broad Unicode emoji range
        emoji_re = re.compile(
            "["
            "\U0001F300-\U0001F9FF"  # Misc symbols and pictographs
            "\U00002600-\U000027BF"  # Misc symbols
            "\U0001FA00-\U0001FAFF"  # Chess, medical etc.
            "\U00002702-\U000027B0"
            "\U000024C2-\U0001F251"
            "]+",
            flags=re.UNICODE,
        )
        return emoji_re.sub("", text)

    def _expand_abbreviations(self, text: str, abbreviations: Dict[str, str]) -> str:
        """
        Replace abbreviations with their spoken forms.

        Uses word-boundary matching so "API" inside "RAPID" is not replaced.
        Longer abbreviations are tried first to prevent partial matches.
        """
        # Sort by length descending so longer keys match first
        for abbrev, expansion in sorted(abbreviations.items(), key=lambda x: -len(x[0])):
            if not abbrev:
                continue
            try:
                # Word-boundary aware, case-sensitive match
                pattern = r"\b" + re.escape(abbrev) + r"\b"
                text = re.sub(pattern, expansion, text)
            except re.error as exc:
                logger.warning("Invalid abbreviation pattern for %r: %s", abbrev, exc)
        return text


# ── Module-level singleton ─────────────────────────────────────────────────────

_normalizer_instance: Optional[SpeechNormalizer] = None


def get_normalizer() -> SpeechNormalizer:
    """Return the shared SpeechNormalizer singleton (lazy-init)."""
    global _normalizer_instance
    if _normalizer_instance is None:
        _normalizer_instance = SpeechNormalizer()
    return _normalizer_instance


def normalize_for_tts(text: str, profile_id: Optional[str] = None) -> str:
    """
    Convenience function: normalize *text* using the global singleton.

    Args:
        text: Raw text to normalize.
        profile_id: Optional profile ID for per-profile rule overrides.

    Returns:
        Cleaned text ready for TTS.
    """
    return get_normalizer().normalize(text, profile_id=profile_id)


__all__ = [
    "SpeechNormalizer",
    "get_normalizer",
    "normalize_for_tts",
]
