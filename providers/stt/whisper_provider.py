"""
Local Whisper STT provider (faster-whisper).

Ref: future-dev-plans/02-PROVIDER-SYSTEMS.md (WhisperProvider section)
Server-side transcription via local faster-whisper model.
"""

from __future__ import annotations

import logging
import os
import tempfile
import time
from typing import Any, Dict, List, Optional

from providers.stt.base import STTError, STTProvider, TranscriptionResult
from providers.registry import ProviderType, registry

logger = logging.getLogger(__name__)


class WhisperProvider(STTProvider):
    """Local Whisper model for server-side transcription via faster-whisper."""

    def __init__(self, config: Dict[str, Any] = None) -> None:
        super().__init__(config)
        self.model_size = self._config.get("model", "base")
        self.device = self._config.get("device", "cpu")
        self._model = None

    def _load_model(self):
        if self._model is None:
            try:
                from faster_whisper import WhisperModel  # type: ignore
                self._model = WhisperModel(self.model_size, device=self.device)
                logger.info("Whisper model loaded: %s on %s", self.model_size, self.device)
            except ImportError:
                raise STTError(
                    "whisper",
                    "faster-whisper not installed: pip install faster-whisper",
                )
            except Exception as exc:
                raise STTError("whisper", f"Failed to load model: {exc}") from exc
        return self._model

    def transcribe(
        self,
        audio_data: bytes,
        language: Optional[str] = None,
        **kwargs,
    ) -> TranscriptionResult:
        start = time.time()
        try:
            model = self._load_model()
        except STTError:
            raise

        # Write to temp WAV file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_data)
            temp_path = f.name

        try:
            segments, info = model.transcribe(temp_path, language=language or "en")
            text = " ".join(seg.text.strip() for seg in segments)
        except Exception as exc:
            raise STTError("whisper", f"Transcription failed: {exc}") from exc
        finally:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

        return TranscriptionResult(
            text=text,
            confidence=0.9,
            language=info.language,
            duration_ms=(time.time() - start) * 1000,
            provider="whisper",
        )

    def is_available(self) -> bool:
        try:
            from faster_whisper import WhisperModel  # type: ignore  # noqa: F401
            return True
        except ImportError:
            return False

    def get_info(self) -> Dict[str, Any]:
        return {
            "name": self._config.get("name", "Whisper Local"),
            "status": "active" if self.is_available() else "inactive",
            "model": self.model_size,
            "device": self.device,
            "available": self.is_available(),
        }


# Auto-register when this module is imported
registry.register(ProviderType.STT, "whisper", WhisperProvider)
