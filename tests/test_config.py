"""
Tests for config/loader.py — P7-T1 coverage (ADR-010, ADR-001)
"""

import os
import tempfile
from pathlib import Path

import pytest

from config.loader import (
    Config,
    _cast,
    _deep_get,
    _deep_set,
    _load_yaml,
    _apply_env_overrides,
    _load_flags,
    config,
)


# ---------------------------------------------------------------------------
# Unit: _cast
# ---------------------------------------------------------------------------

class TestCast:
    def test_bool_true_values(self):
        for val in ("true", "1", "yes", "True", "YES"):
            assert _cast(val, "bool") is True

    def test_bool_false_values(self):
        for val in ("false", "0", "no", ""):
            assert _cast(val, "bool") is False

    def test_int_cast(self):
        assert _cast("5001", int) == 5001

    def test_float_cast(self):
        assert _cast("3.14", float) == pytest.approx(3.14)

    def test_str_passthrough(self):
        assert _cast("hello", str) == "hello"


# ---------------------------------------------------------------------------
# Unit: _deep_set / _deep_get
# ---------------------------------------------------------------------------

class TestDeepAccess:
    def test_deep_set_single_key(self):
        d = {}
        _deep_set(d, "foo", 42)
        assert d == {"foo": 42}

    def test_deep_set_nested(self):
        d = {}
        _deep_set(d, "a.b.c", "val")
        assert d["a"]["b"]["c"] == "val"

    def test_deep_set_overwrites(self):
        d = {"a": {"b": 1}}
        _deep_set(d, "a.b", 99)
        assert d["a"]["b"] == 99

    def test_deep_get_single_key(self):
        assert _deep_get({"foo": 42}, "foo") == 42

    def test_deep_get_nested(self):
        d = {"a": {"b": {"c": "deep"}}}
        assert _deep_get(d, "a.b.c") == "deep"

    def test_deep_get_missing_returns_default(self):
        assert _deep_get({}, "x.y.z", "fallback") == "fallback"

    def test_deep_get_missing_returns_none_by_default(self):
        assert _deep_get({}, "nope") is None


# ---------------------------------------------------------------------------
# Unit: _load_yaml
# ---------------------------------------------------------------------------

class TestLoadYaml:
    def test_loads_existing_yaml(self, tmp_path):
        f = tmp_path / "test.yaml"
        f.write_text("key: value\nnested:\n  a: 1\n")
        data = _load_yaml(f)
        assert data["key"] == "value"
        assert data["nested"]["a"] == 1

    def test_returns_empty_dict_for_missing_file(self, tmp_path):
        data = _load_yaml(tmp_path / "nonexistent.yaml")
        assert data == {}

    def test_returns_empty_dict_for_empty_yaml(self, tmp_path):
        f = tmp_path / "empty.yaml"
        f.write_text("")
        data = _load_yaml(f)
        assert data == {}


# ---------------------------------------------------------------------------
# Unit: _apply_env_overrides
# ---------------------------------------------------------------------------

class TestEnvOverrides:
    def test_port_override(self, monkeypatch):
        monkeypatch.setenv("PORT", "9999")
        data = {"server": {"port": 5001}}
        _apply_env_overrides(data)
        assert data["server"]["port"] == 9999

    def test_bool_override(self, monkeypatch):
        monkeypatch.setenv("USE_GROQ_TTS", "true")
        data = {"tts": {"use_groq": False}}
        _apply_env_overrides(data)
        assert data["tts"]["use_groq"] is True

    def test_unset_env_vars_not_applied(self, monkeypatch):
        monkeypatch.delenv("PORT", raising=False)
        data = {"server": {"port": 5001}}
        _apply_env_overrides(data)
        assert data["server"]["port"] == 5001

    def test_double_underscore_override(self, monkeypatch):
        monkeypatch.setenv("SERVER__PORT", "7777")
        data = {"server": {"port": 5001}}
        _apply_env_overrides(data)
        assert data["server"]["port"] == "7777"


# ---------------------------------------------------------------------------
# Unit: _load_flags
# ---------------------------------------------------------------------------

class TestLoadFlags:
    def test_loads_flags_from_file(self, tmp_path):
        f = tmp_path / "flags.yaml"
        f.write_text("flags:\n  use_blueprints: true\n  use_persistent_websocket: false\n")
        flags = _load_flags(f)
        assert flags["use_blueprints"] is True
        assert flags["use_persistent_websocket"] is False

    def test_env_override_flag(self, tmp_path, monkeypatch):
        f = tmp_path / "flags.yaml"
        f.write_text("flags:\n  use_blueprints: false\n")
        monkeypatch.setenv("FEATURE_USE_BLUEPRINTS", "true")
        flags = _load_flags(f)
        assert flags["use_blueprints"] is True

    def test_missing_flags_file_returns_empty(self, tmp_path):
        flags = _load_flags(tmp_path / "no_flags.yaml")
        assert flags == {}


# ---------------------------------------------------------------------------
# Integration: Config class
# ---------------------------------------------------------------------------

class TestConfigClass:
    def test_config_loads_defaults(self):
        c = Config()
        # server.port is set in default.yaml
        assert c.get("server.port") is not None

    def test_get_returns_default_on_missing(self):
        c = Config()
        assert c.get("nonexistent.key", "fallback") == "fallback"

    def test_getitem_works(self):
        c = Config()
        # server section exists
        val = c["server.port"]
        assert val is not None

    def test_getitem_raises_on_missing(self):
        c = Config()
        with pytest.raises(KeyError):
            _ = c["no.such.key.ever"]

    def test_contains_true(self):
        c = Config()
        assert "server.port" in c

    def test_contains_false(self):
        c = Config()
        assert "does.not.exist" not in c

    def test_as_dict_returns_copy(self):
        c = Config()
        d = c.as_dict()
        assert isinstance(d, dict)
        # Mutating returned dict doesn't affect config
        d["injected"] = True
        assert c.get("injected") is None

    def test_flag_returns_false_for_unknown(self):
        c = Config()
        assert c.flag("totally_fake_flag_xyz") is False

    def test_flag_uses_default(self):
        c = Config()
        assert c.flag("totally_fake_flag_xyz", default=True) is True

    def test_flag_reads_real_flags(self):
        c = Config()
        # flags.yaml exists in the project — just verify flag() returns bool
        result = c.flag("use_blueprints")
        assert isinstance(result, bool)

    def test_reload_doesnt_crash(self):
        c = Config()
        c.reload()  # should not raise

    def test_singleton_config_importable(self):
        assert config is not None
        assert isinstance(config, Config)
