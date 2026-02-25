"""
Tests for provider base classes (P5-T1).
ADR-003: Abstract base class + registry pattern.
"""

import pytest
from providers.base import BaseProvider, ProviderError, ProviderUnavailableError
from providers.llm.base import LLMProvider, LLMResponse
from providers.tts.base import TTSProvider, TTSVoice
from providers.stt.base import STTProvider, TranscriptionResult


# ---------------------------------------------------------------------------
# Concrete minimal implementations for testing
# ---------------------------------------------------------------------------

class _MockLLM(LLMProvider):
    def generate(self, messages, system_prompt=None, model=None, **kwargs):
        return LLMResponse(content="ok", model="mock", provider="mock")

    def generate_stream(self, messages, system_prompt=None, model=None, **kwargs):
        yield "ok"

    def is_available(self):
        return True


class _MockTTS(TTSProvider):
    def generate_speech(self, text, **kwargs):
        return b"audio"

    def list_voices(self):
        return ["v1", "v2"]

    def is_available(self):
        return True


class _MockSTT(STTProvider):
    def transcribe(self, audio_data, language=None, **kwargs):
        return TranscriptionResult(text="hello", provider="mock")

    def is_available(self):
        return True


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_llm_provider_generate():
    llm = _MockLLM({"name": "mock-llm"})
    resp = llm.generate([{"role": "user", "content": "hi"}])
    assert resp.content == "ok"
    assert resp.model == "mock"


def test_llm_provider_stream():
    llm = _MockLLM()
    chunks = list(llm.generate_stream([{"role": "user", "content": "hi"}]))
    assert chunks == ["ok"]


def test_llm_provider_is_available():
    assert _MockLLM().is_available() is True


def test_llm_provider_get_info():
    info = _MockLLM({"name": "test-llm"}).get_info()
    assert info["name"] == "test-llm"
    assert info["available"] is True


def test_tts_provider_generate_speech():
    tts = _MockTTS({"name": "mock-tts"})
    audio = tts.generate_speech("hello")
    assert audio == b"audio"


def test_tts_provider_list_voices():
    tts = _MockTTS()
    assert "v1" in tts.list_voices()


def test_tts_provider_default_voice():
    assert _MockTTS().get_default_voice() == "v1"


def test_tts_provider_validate_text_raises_on_empty():
    with pytest.raises(ValueError):
        _MockTTS().validate_text("")


def test_tts_provider_validate_voice():
    tts = _MockTTS()
    assert tts.validate_voice("v1") is True
    assert tts.validate_voice("nope") is False


def test_tts_voice_to_dict():
    v = TTSVoice(id="M1", name="Male 1", language="en", gender="male")
    d = v.to_dict()
    assert d["id"] == "M1"
    assert d["gender"] == "male"


def test_stt_provider_transcribe():
    stt = _MockSTT()
    result = stt.transcribe(b"audio")
    assert result.text == "hello"
    assert result.provider == "mock"


def test_stt_provider_is_available():
    assert _MockSTT().is_available() is True


def test_provider_error_message():
    err = ProviderError("my-provider", "something went wrong")
    assert "my-provider" in str(err)
    assert "something went wrong" in str(err)


def test_provider_repr():
    llm = _MockLLM({"name": "test"})
    assert "MockLLM" in repr(llm)
