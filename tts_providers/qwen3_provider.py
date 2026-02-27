"""
Qwen3-TTS Provider — fal.ai hosted Qwen3-TTS 1.7B model.

Uses fal.ai's REST API (no SDK required). Returns MP3 audio bytes.
Model: fal-ai/qwen-3-tts/text-to-speech/1.7b
API key: FAL_KEY env var
"""

import os
import time
import logging

import httpx

from .base_provider import TTSProvider

logger = logging.getLogger(__name__)

FAL_ENDPOINT = "https://fal.run/fal-ai/qwen-3-tts/text-to-speech/1.7b"

AVAILABLE_VOICES = [
    "Vivian",    # Female, warm
    "Serena",    # Female, clear
    "Dylan",     # Male, casual
    "Eric",      # Male, professional
    "Ryan",      # Male, energetic
    "Aiden",     # Male, deep
    "Uncle_Fu",  # Male, character
    "Ono_Anna",  # Female, Japanese accent
    "Sohee",     # Female, Korean accent
]


class Qwen3Provider(TTSProvider):
    """
    TTS Provider using Qwen3-TTS 1.7B via fal.ai.

    Voices: Vivian, Serena, Dylan, Eric, Ryan, Aiden, Uncle_Fu, Ono_Anna, Sohee
    Output: MP3 audio bytes
    Latency: ~500ms-1s (cloud, fast)
    Cost: fal.ai pay-per-use (cheap)
    """

    def __init__(self):
        super().__init__()
        self.api_key = os.getenv('FAL_KEY', '')
        self._status = 'active' if self.api_key else 'error'
        self._init_error = None if self.api_key else 'FAL_KEY not set in environment'

    def generate_speech(self, text: str, voice: str = 'Vivian', **kwargs) -> bytes:
        """
        Generate speech via fal.ai Qwen3-TTS 1.7B.

        Args:
            text: Text to synthesize.
            voice: One of the AVAILABLE_VOICES. Default: 'Vivian'.
            **kwargs: Optional — language (default 'English'), prompt (style hint).

        Returns:
            MP3 audio bytes.
        """
        if not self.api_key:
            raise RuntimeError("FAL_KEY not set — cannot call fal.ai API")

        self.validate_text(text)

        if voice not in AVAILABLE_VOICES:
            logger.warning(f"Unknown voice '{voice}', falling back to Vivian")
            voice = 'Vivian'

        language = kwargs.get('language', 'English')
        prompt = kwargs.get('prompt', '')

        payload = {
            "text": text,
            "voice": voice,
            "language": language,
        }
        if prompt:
            payload["prompt"] = prompt

        t = time.time()
        logger.info(f"[Qwen3] Requesting TTS: '{text[:60]}...' voice={voice}")

        headers = {
            'Authorization': f'Key {self.api_key}',
            'Content-Type': 'application/json',
        }

        try:
            with httpx.Client(timeout=httpx.Timeout(90.0, connect=10.0)) as client:
                resp = client.post(FAL_ENDPOINT, json=payload, headers=headers)
                resp.raise_for_status()
                result = resp.json()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"fal.ai API error {e.response.status_code}: {e.response.text}")
        except Exception as e:
            raise RuntimeError(f"fal.ai request failed: {e}")

        audio_url = result.get('audio', {}).get('url')
        if not audio_url:
            raise RuntimeError(f"No audio URL in fal.ai response: {result}")

        # Download the MP3
        try:
            with httpx.Client(timeout=httpx.Timeout(30.0)) as client:
                audio_resp = client.get(audio_url)
                audio_resp.raise_for_status()
                audio_bytes = audio_resp.content
        except Exception as e:
            raise RuntimeError(f"Failed to download audio from fal.ai: {e}")

        elapsed = int((time.time() - t) * 1000)
        logger.info(f"[Qwen3] Generated {len(audio_bytes)} bytes in {elapsed}ms")
        return audio_bytes

    def health_check(self) -> dict:
        """Check if fal.ai API key is set and reachable."""
        if not self.api_key:
            return {"ok": False, "latency_ms": 0, "detail": "FAL_KEY not set"}

        t = time.time()
        try:
            with httpx.Client(timeout=httpx.Timeout(8.0)) as client:
                resp = client.get("https://fal.run/", headers={"Authorization": f"Key {self.api_key}"})
            latency_ms = int((time.time() - t) * 1000)
            # Any response (even 404) means we're connected
            return {"ok": True, "latency_ms": latency_ms, "detail": "fal.ai reachable — Qwen3-TTS 1.7B ready"}
        except Exception as e:
            latency_ms = int((time.time() - t) * 1000)
            return {"ok": False, "latency_ms": latency_ms, "detail": str(e)}

    def list_voices(self) -> list:
        return AVAILABLE_VOICES.copy()

    def get_default_voice(self) -> str:
        return 'Vivian'

    def is_available(self) -> bool:
        return bool(self.api_key)

    def get_info(self) -> dict:
        return {
            'name': 'Qwen3-TTS (fal.ai)',
            'provider_id': 'qwen3',
            'status': self._status,
            'description': 'Qwen3-TTS 1.7B via fal.ai — expressive, multilingual, fast cloud TTS',
            'quality': 'very-high',
            'latency': 'fast',
            'cost_per_minute': 0.003,
            'voices': AVAILABLE_VOICES.copy(),
            'features': ['multilingual', 'expressive', 'voice-design', 'cloud', 'mp3-output'],
            'requires_api_key': True,
            'languages': ['en', 'zh', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'pt', 'ru'],
            'max_characters': 5000,
            'notes': 'Qwen3-TTS 1.7B model. FAL_KEY required.',
            'default_voice': 'Vivian',
            'audio_format': 'mp3',
            'sample_rate': 24000,
            'error': self._init_error,
        }
