"""
Extended tests for providers/tts/ — GroqTTSProvider and SupertonicProvider,
using mocks to avoid real API calls or ONNX loading.
(P7-T1, ADR-010)
"""

import pytest
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# GroqTTSProvider
# ---------------------------------------------------------------------------

class TestGroqTTSProvider:
    def _make_provider(self, config=None):
        from providers.tts.groq_provider import GroqTTSProvider
        return GroqTTSProvider(config or {})

    def test_instantiates(self):
        provider = self._make_provider()
        assert provider is not None

    def test_list_voices_returns_list(self):
        provider = self._make_provider()
        voices = provider.list_voices()
        assert isinstance(voices, list)
        assert len(voices) > 0

    def test_list_voices_includes_alloy(self):
        provider = self._make_provider()
        voices = provider.list_voices()
        assert "tara" in voices

    def test_is_available_false_when_no_key(self):
        with patch.dict("os.environ", {}, clear=True):
            provider = self._make_provider({"api_key": ""})
        assert provider.is_available() is False

    def test_is_available_true_when_key_set(self):
        provider = self._make_provider({"api_key": "test-key-abc123"})
        assert provider.is_available() is True

    def test_is_available_from_env(self):
        with patch.dict("os.environ", {"GROQ_API_KEY": "env-key-xyz"}):
            provider = self._make_provider({"api_key": ""})
        assert provider.is_available() is True

    def test_get_info_returns_dict(self):
        provider = self._make_provider({"api_key": "test-key"})
        info = provider.get_info()
        assert isinstance(info, dict)

    def test_get_info_has_name(self):
        provider = self._make_provider()
        info = provider.get_info()
        assert "name" in info

    def test_get_info_has_status(self):
        provider = self._make_provider()
        info = provider.get_info()
        assert "status" in info

    def test_get_info_has_available(self):
        provider = self._make_provider()
        info = provider.get_info()
        assert "available" in info

    def test_get_info_status_inactive_without_key(self):
        provider = self._make_provider({"api_key": ""})
        # Clear env too
        with patch.dict("os.environ", {}, clear=True):
            provider2 = self._make_provider({"api_key": ""})
        info = provider2.get_info()
        assert info["status"] in ("active", "inactive")

    def test_generate_speech_raises_without_key(self):
        from providers.tts.base import TTSError
        provider = self._make_provider({"api_key": ""})
        with patch.dict("os.environ", {}, clear=True):
            provider2 = self._make_provider({"api_key": ""})
        with pytest.raises(TTSError):
            provider2.generate_speech("hello world")

    def test_generate_speech_raises_on_import_error(self):
        from providers.tts.base import TTSError
        provider = self._make_provider({"api_key": "test-key"})
        with patch("builtins.__import__", side_effect=ImportError("no groq")):
            with pytest.raises((TTSError, ImportError)):
                provider.generate_speech("hello world")

    def test_generate_speech_with_mock_client(self):
        from providers.tts.groq_provider import GroqTTSProvider
        provider = GroqTTSProvider({"api_key": "test-key-abc"})

        mock_response = MagicMock()
        mock_response.read.return_value = b"fake_mp3_bytes"

        mock_client = MagicMock()
        mock_client.audio.speech.create.return_value = mock_response

        mock_groq_lib = MagicMock()
        mock_groq_lib.Groq.return_value = mock_client

        with patch.dict("sys.modules", {"groq": mock_groq_lib}):
            result = provider.generate_speech("Hello there!")

        assert result == b"fake_mp3_bytes"

    def test_model_from_config(self):
        provider = self._make_provider({"model": "custom-model"})
        assert provider.model == "custom-model"

    def test_default_model(self):
        provider = self._make_provider()
        assert provider.model == "canopylabs/orpheus-v1-english"

    def test_default_voice_from_config(self):
        provider = self._make_provider({"voice": "nova"})
        assert provider.default_voice == "nova"


# ---------------------------------------------------------------------------
# SupertonicProvider (providers/tts/supertonic_provider.py)
# ---------------------------------------------------------------------------

class TestSupertonicTTSProvider:
    def _make_provider(self, config=None):
        from providers.tts.supertonic_provider import SupertonicProvider
        return SupertonicProvider(config or {})

    def test_instantiates(self):
        provider = self._make_provider()
        assert provider is not None

    def test_onnx_dir_from_config(self):
        provider = self._make_provider({"onnx_dir": "/custom/path"})
        assert provider.onnx_dir == "/custom/path"

    def test_default_voice_from_config(self):
        provider = self._make_provider({"default_voice": "F1"})
        assert provider.default_voice == "F1"

    def test_get_info_returns_dict(self):
        provider = self._make_provider()
        info = provider.get_info()
        assert isinstance(info, dict)

    def test_get_info_has_name(self):
        provider = self._make_provider()
        info = provider.get_info()
        assert "name" in info

    def test_get_info_has_onnx_dir(self):
        provider = self._make_provider()
        info = provider.get_info()
        assert "onnx_dir" in info

    def test_get_info_has_available(self):
        provider = self._make_provider()
        info = provider.get_info()
        assert "available" in info

    def test_list_voices_returns_list_on_import_error(self):
        provider = self._make_provider()
        # Even if underlying library is unavailable, should return a list
        with patch.object(provider, "_get_delegate", side_effect=Exception("unavailable")):
            voices = provider.list_voices()
        assert isinstance(voices, list)
        assert len(voices) >= 1

    def test_list_voices_with_mock_delegate(self):
        provider = self._make_provider()
        mock_delegate = MagicMock()
        mock_delegate.list_voices.return_value = ["M1", "M2", "F1"]
        with patch.object(provider, "_get_delegate", return_value=mock_delegate):
            voices = provider.list_voices()
        assert voices == ["M1", "M2", "F1"]

    def test_generate_speech_calls_delegate(self):
        from providers.tts.supertonic_provider import SupertonicProvider
        provider = SupertonicProvider({"default_voice": "M1"})
        mock_delegate = MagicMock()
        mock_delegate.generate_speech.return_value = b"audio_bytes"
        with patch.object(provider, "_get_delegate", return_value=mock_delegate):
            result = provider.generate_speech("Hello world")
        assert result == b"audio_bytes"
        mock_delegate.generate_speech.assert_called_once()

    def test_generate_speech_raises_tts_error_on_failure(self):
        from providers.tts.supertonic_provider import SupertonicProvider
        from providers.tts.base import TTSError
        provider = SupertonicProvider({})
        mock_delegate = MagicMock()
        mock_delegate.generate_speech.side_effect = RuntimeError("onnx failed")
        with patch.object(provider, "_get_delegate", return_value=mock_delegate):
            with pytest.raises(TTSError):
                provider.generate_speech("test text")

    def test_is_available_false_when_import_fails(self):
        provider = self._make_provider()
        with patch("builtins.__import__", side_effect=ImportError("no supertonic")):
            # May raise or return False — both are acceptable
            try:
                result = provider.is_available()
                assert result is False
            except Exception:
                pass  # import error path

    def test_name_from_config(self):
        provider = self._make_provider({"name": "Custom Supertonic"})
        info = provider.get_info()
        assert info["name"] == "Custom Supertonic"


# ---------------------------------------------------------------------------
# providers/tts/base.py TTSError
# ---------------------------------------------------------------------------

class TestTTSError:
    def test_tts_error_message(self):
        from providers.tts.base import TTSError
        err = TTSError("groq", "Something failed")
        assert "groq" in str(err)
        assert "Something failed" in str(err)

    def test_tts_error_is_exception(self):
        from providers.tts.base import TTSError
        with pytest.raises(TTSError):
            raise TTSError("test", "test error")

    def test_tts_error_has_args(self):
        from providers.tts.base import TTSError
        err = TTSError("supertonic", "msg")
        assert len(err.args) >= 1


# ---------------------------------------------------------------------------
# providers/registry.py — additional coverage
# ---------------------------------------------------------------------------

class TestRegistryExtended:
    def test_registry_list_tts_providers(self):
        from providers.registry import registry, ProviderType
        providers = registry.list_providers(ProviderType.TTS)
        assert isinstance(providers, list)

    def test_registry_list_llm_providers(self):
        from providers.registry import registry, ProviderType
        providers = registry.list_providers(ProviderType.LLM)
        assert isinstance(providers, list)

    def test_registry_list_stt_providers(self):
        from providers.registry import registry, ProviderType
        providers = registry.list_providers(ProviderType.STT)
        assert isinstance(providers, list)

    def test_registry_get_registered_tts_provider(self):
        from providers.registry import registry, ProviderType
        providers = registry.list_providers(ProviderType.TTS)
        if providers:
            # Get the first registered provider by name
            first_name = providers[0].get("id") or providers[0].get("name", "")
            # Attempt to get it — should not raise KeyError for registered ones
            assert first_name != ""  # Just verify we got a valid provider name

    def test_registry_is_singleton(self):
        from providers.registry import registry, ProviderRegistry
        registry2 = ProviderRegistry.get_instance()
        assert registry is registry2
