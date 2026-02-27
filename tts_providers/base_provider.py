#!/usr/bin/env python3
"""
Base TTS Provider Abstract Class for OpenVoiceUI.

This module defines the abstract interface that all TTS providers must implement.
It provides a consistent API for generating speech, listing available voices,
and retrieving provider information.

Author: OpenVoiceUI
Date: 2026-02-11
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from dataclasses import dataclass


@dataclass
class TTSVoice:
    """
    Represents a single voice available from a TTS provider.

    Attributes:
        id: Unique identifier for the voice (e.g., 'M1', 'your-hume-voice-id')
        name: Human-readable name (e.g., 'Male Voice 1', 'Custom Voice')
        language: Language code (e.g., 'en-US', 'en', 'es')
        gender: Gender of the voice ('male', 'female', 'neutral', or None)
        description: Optional description of the voice characteristics
    """
    id: str
    name: str
    language: str = 'en'
    gender: Optional[str] = None
    description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert the voice to a dictionary representation."""
        return {
            'id': self.id,
            'name': self.name,
            'language': self.language,
            'gender': self.gender,
            'description': self.description
        }


@dataclass
class TTSProviderInfo:
    """
    Metadata about a TTS provider.

    Attributes:
        name: Provider name (e.g., 'supertonic', 'hume')
        display_name: Human-readable name (e.g., 'Supertonic TTS', 'Hume EVI')
        version: Provider version string
        cost_per_minute: Cost in USD per minute of generated audio
        quality: Quality rating ('low', 'medium', 'high', 'premium')
        latency: Expected latency ('instant', 'fast', 'medium', 'slow')
        features: List of feature strings (e.g., ['emotion-aware', 'multi-language'])
        requires_api_key: Whether the provider requires an API key
        is_online: Whether the provider requires internet connectivity
        status: Current status ('active', 'inactive', 'error')
    """
    name: str
    display_name: str
    version: str
    cost_per_minute: float
    quality: str
    latency: str
    features: List[str]
    requires_api_key: bool
    is_online: bool
    status: str = 'active'

    def to_dict(self) -> Dict[str, Any]:
        """Convert the provider info to a dictionary representation."""
        return {
            'name': self.name,
            'display_name': self.display_name,
            'version': self.version,
            'cost_per_minute': self.cost_per_minute,
            'quality': self.quality,
            'latency': self.latency,
            'features': self.features,
            'requires_api_key': self.requires_api_key,
            'is_online': self.is_online,
            'status': self.status
        }


class TTSProvider(ABC):
    """
    Abstract base class for Text-to-Speech providers.

    All TTS providers must inherit from this class and implement the required methods.
    This ensures a consistent interface across different TTS backends.

    Required Methods:
        - generate_speech(text, **kwargs): Convert text to audio bytes
        - list_voices(): Return list of available voice names
        - get_info(): Return provider metadata (name, status, capabilities)

    Example:
        >>> class MyTTS(TTSProvider):
        ...     def generate_speech(self, text, **kwargs):
        ...         # Implementation here
        ...         return audio_bytes
        ...     def list_voices(self):
        ...         return ['voice1', 'voice2']
        ...     def get_info(self):
        ...         return {'name': 'MyTTS', 'status': 'active'}
    """

    @abstractmethod
    def generate_speech(self, text: str, **kwargs) -> bytes:
        """
        Generate speech audio from the given text.

        Args:
            text: The text to synthesize into speech.
            **kwargs: Provider-specific parameters (voice, speed, lang, etc.)

        Returns:
            bytes: Raw audio data (usually WAV format) that can be written
                   to a file or sent via HTTP with Content-Type: audio/wav.

        Raises:
            ValueError: If text is empty or parameters are invalid.
            RuntimeError: If speech generation fails.

        Example:
            >>> audio = provider.generate_speech("Hello world", voice='M1')
            >>> with open('output.wav', 'wb') as f:
            ...     f.write(audio)
        """
        pass

    @abstractmethod
    def list_voices(self) -> List[str]:
        """
        Return a list of available voice names for this provider.

        Returns:
            List[str]: List of voice identifiers (e.g., ['M1', 'M2', 'F1']).
                       These IDs should be valid values for a 'voice' parameter
                       in generate_speech().

        Example:
            >>> provider.list_voices()
            ['M1', 'M2', 'F1', 'F2']
        """
        pass

    @abstractmethod
    def get_info(self) -> Dict[str, Any]:
        """
        Return metadata about this TTS provider.

        Returns:
            Dict with at minimum:
                - 'name': str - Provider display name
                - 'status': str - 'active', 'inactive', or 'error'
                - 'description': str - Brief description of the provider
                - 'capabilities': dict - Optional feature flags
                    - 'streaming': bool - Supports streaming audio
                    - 'ssml': bool - Supports SSML markup
                    - 'custom_voices': bool - Supports custom voice cloning
                    - 'languages': List[str] - Supported language codes

        Example:
            >>> provider.get_info()
            {
                'name': 'Supertonic',
                'status': 'active',
                'description': 'Local ONNX-based TTS engine',
                'capabilities': {
                    'streaming': False,
                    'ssml': False,
                    'custom_voices': True,
                    'languages': ['en', 'ko', 'es', 'pt', 'fr']
                }
            }
        """
        pass

    def is_available(self) -> bool:
        """
        Check if this provider is currently available for use.

        Returns:
            bool: True if the provider is active and ready, False otherwise.

        Default implementation checks if get_info()['status'] == 'active'.
        Subclasses can override for more complex availability checks.

        Example:
            >>> if provider.is_available():
            ...     audio = provider.generate_speech("Hello")
        """
        return self.get_info().get('status', 'inactive') == 'active'

    def validate_text(self, text: str) -> None:
        """
        Validate that text is suitable for speech generation.

        Args:
            text: Text to validate.

        Raises:
            ValueError: If text is None, empty, or only whitespace.

        Example:
            >>> provider.validate_text("Hello world")  # OK
            >>> provider.validate_text("")  # Raises ValueError
        """
        if text is None:
            raise ValueError("Text cannot be None")
        if not isinstance(text, str):
            raise ValueError(f"Text must be a string, got {type(text).__name__}")
        if not text.strip():
            raise ValueError("Text cannot be empty or contain only whitespace")

    def validate_voice(self, voice: str) -> bool:
        """
        Check if a given voice name is valid for this provider.

        Args:
            voice: Voice identifier to validate.

        Returns:
            bool: True if the voice is available, False otherwise.

        Example:
            >>> provider.validate_voice('M1')
            True
            >>> provider.validate_voice('invalid')
            False
        """
        return voice in self.list_voices()

    def get_default_voice(self) -> Optional[str]:
        """
        Return the default voice for this provider.

        Returns:
            The first voice in list_voices(), or None if no voices available.

        Example:
            >>> provider.get_default_voice()
            'M1'
        """
        voices = self.list_voices()
        return voices[0] if voices else None

    def __repr__(self) -> str:
        """String representation of the provider."""
        info = self.get_info()
        return f"{self.__class__.__name__}(name='{info.get('name', 'Unknown')}', status='{info.get('status', 'unknown')}')"


class TTSProviderError(Exception):
    """
    Base exception class for TTS provider errors.

    This exception is raised when a TTS provider encounters an error
    that is specific to the provider implementation.
    """

    def __init__(self, provider_name: str, message: str):
        """
        Initialize the exception.

        Args:
            provider_name: Name of the provider that raised the error.
            message: Error message describing what went wrong.
        """
        self.provider_name = provider_name
        super().__init__(f"[{provider_name}] {message}")


class TTSGenerationError(TTSProviderError):
    """
    Raised when speech generation fails.

    This can occur due to invalid input, network issues, or
    problems with the TTS service.
    """
    pass


class TTSConfigurationError(TTSProviderError):
    """
    Raised when the provider is misconfigured.

    This can occur due to missing API keys, invalid paths,
    or other configuration issues.
    """
    pass


class TTSVoiceNotFoundError(TTSProviderError):
    """
    Raised when a requested voice is not available.

    This occurs when a voice ID is specified that doesn't
    exist in the provider's voice catalog.
    """
    pass


__all__ = [
    'TTSProvider',
    'TTSVoice',
    'TTSProviderInfo',
    'TTSProviderError',
    'TTSGenerationError',
    'TTSConfigurationError',
    'TTSVoiceNotFoundError',
]
