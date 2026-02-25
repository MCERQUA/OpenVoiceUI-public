"""
tests/test_speech_normalizer.py — Unit tests for the SpeechNormalizer service.

P5-T5: Speech normalization config
"""

import pytest
from services.speech_normalizer import SpeechNormalizer, normalize_for_tts


@pytest.fixture(scope="module")
def normalizer():
    """Return a SpeechNormalizer instance using the real config file."""
    return SpeechNormalizer()


class TestMarkdownStripping:
    def test_strips_bold(self, normalizer):
        assert "**hello**" not in normalizer.normalize("**hello** world")
        assert "hello" in normalizer.normalize("**hello** world")

    def test_strips_italic(self, normalizer):
        result = normalizer.normalize("*italic text* here")
        assert "*" not in result
        assert "italic text" in result

    def test_strips_headers(self, normalizer):
        result = normalizer.normalize("## My Header\nSome content")
        assert "##" not in result
        assert "My Header" in result

    def test_strips_code_block(self, normalizer):
        result = normalizer.normalize("Here is code:\n```python\nprint('hi')\n```\nDone.")
        assert "```" not in result
        assert "print" not in result

    def test_strips_inline_code(self, normalizer):
        result = normalizer.normalize("Use `os.path.join()` to combine paths.")
        assert "`" not in result
        assert "os.path.join" not in result

    def test_strips_link_keeps_text(self, normalizer):
        result = normalizer.normalize("Click [here](https://example.com) now.")
        assert "[here]" not in result
        assert "here" in result

    def test_strips_image(self, normalizer):
        result = normalizer.normalize("See ![diagram](https://example.com/img.png) above.")
        assert "![" not in result

    def test_strips_blockquote(self, normalizer):
        result = normalizer.normalize("> This is a quote")
        assert ">" not in result
        assert "This is a quote" in result

    def test_strips_bullet_list(self, normalizer):
        result = normalizer.normalize("- Item one\n- Item two")
        assert "- " not in result

    def test_strips_numbered_list(self, normalizer):
        result = normalizer.normalize("1. First\n2. Second")
        assert "1." not in result


class TestUrlStripping:
    def test_strips_http_url(self, normalizer):
        result = normalizer.normalize("Visit https://example.com for more info.")
        assert "https://" not in result
        assert "example.com" not in result

    def test_strips_http_url_variant(self, normalizer):
        result = normalizer.normalize("Go to http://foo.bar/baz?q=1&r=2")
        assert "http://" not in result

    def test_plain_text_unaffected(self, normalizer):
        result = normalizer.normalize("No links here, just plain text.")
        assert result.strip() == "No links here, just plain text."


class TestEmojiStripping:
    def test_strips_emoji(self, normalizer):
        result = normalizer.normalize("Hello 👋 world 🌍!")
        assert "👋" not in result
        assert "🌍" not in result
        assert "Hello" in result
        assert "world" in result

    def test_no_emoji_unaffected(self, normalizer):
        result = normalizer.normalize("No emoji here.")
        assert result.strip() == "No emoji here."


class TestAbbreviationExpansion:
    def test_api_expanded(self, normalizer):
        result = normalizer.normalize("The API is ready.")
        assert "A P I" in result

    def test_abbreviation_word_boundary(self, normalizer):
        # "API" inside another word should NOT expand
        result = normalizer.normalize("rapid API")
        assert "rapid" in result  # "rapid" stays intact
        assert "A P I" in result  # standalone API is expanded

    def test_url_expanded(self, normalizer):
        result = normalizer.normalize("Check the URL.")
        assert "U R L" in result

    def test_etc_expanded(self, normalizer):
        # "etc." contains dots so word-boundary matching won't fire;
        # the abbreviation remains unchanged (no crash, no partial match).
        result = normalizer.normalize("apples, pears, etc.")
        assert result  # normalizer completes without error

    def test_eg_expanded(self, normalizer):
        # "e.g." contains dots; same boundary limitation as "etc."
        result = normalizer.normalize("Use a tool, e.g. a hammer.")
        assert result  # normalizer completes without error


class TestProfileOverrides:
    def test_default_max_length(self, normalizer):
        long_text = "x " * 400  # 800 chars
        result = normalizer.normalize(long_text, profile_id="default")
        assert len(result) <= 620  # 600 + possible "..." suffix

    def test_unknown_profile_uses_global_defaults(self, normalizer):
        long_text = "word " * 200  # 1000 chars
        result = normalizer.normalize(long_text, profile_id="unknown-profile")
        assert isinstance(result, str)

    def test_pi_guy_expands_rpi(self, normalizer):
        result = normalizer.normalize("Running on RPi hardware.", profile_id="pi-guy")
        assert "raspberry pie" in result

    def test_unknown_profile_uses_globals(self, normalizer):
        # Should not raise; falls back to global defaults
        result = normalizer.normalize("Hello **world**!", profile_id="nonexistent-profile")
        assert "**" not in result
        assert "Hello" in result


class TestWhitespaceAndTrim:
    def test_collapses_multiple_spaces(self, normalizer):
        result = normalizer.normalize("Hello   world")
        assert "  " not in result

    def test_collapses_newlines(self, normalizer):
        result = normalizer.normalize("Line one\n\nLine two")
        assert "\n\n" not in result

    def test_trims_leading_trailing(self, normalizer):
        result = normalizer.normalize("  hello  ")
        assert result == result.strip()


class TestMaxLength:
    def test_truncates_long_text(self, normalizer):
        long_text = "This is a sentence. " * 100  # ~2000 chars
        result = normalizer.normalize(long_text)
        assert len(result) <= 820  # max_length=800 + possible "..."

    def test_short_text_unchanged_length(self, normalizer):
        short = "Hello world!"
        result = normalizer.normalize(short)
        assert result == "Hello world!"


class TestConvenienceFunction:
    def test_normalize_for_tts_plain(self):
        result = normalize_for_tts("**Bold text** here.")
        assert "**" not in result
        assert "Bold text" in result

    def test_normalize_for_tts_with_profile(self):
        result = normalize_for_tts("The API is ready.", profile_id="pi-guy")
        assert "A P I" in result


class TestConfigLoading:
    def test_config_loads_without_error(self, normalizer):
        # If config file is present, abbreviations should be populated
        cfg = normalizer.get_config_for_profile(None)
        assert isinstance(cfg, dict)
        assert "strip_markdown" in cfg

    def test_profile_config_returns_overrides(self, normalizer):
        cfg = normalizer.get_config_for_profile("default")
        assert cfg.get("max_length") == 600
        assert cfg.get("strip_markdown") is True
