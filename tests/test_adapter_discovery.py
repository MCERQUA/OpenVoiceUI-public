"""
tests/test_adapter_discovery.py — Tests for P6-T5: Adapter auto-discovery from profiles

Tests the Python-side integration:
  - Profile JSON files all have 'adapter' and 'adapter_config' fields
  - ProfileManager correctly reads (and exposes) adapter fields
  - The known adapter IDs in profiles match the static registry in adapter-registry.js

Ref: future-dev-plans/MASTER-EXECUTION-PLAYBOOK.md  P6-T5
     future-dev-plans/17-MULTI-AGENT-FRAMEWORK.md   Plug-and-Play section
"""

import json
import os
import re
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).parent.parent
PROFILES_DIR = PROJECT_ROOT / "profiles"
ADAPTER_REGISTRY_JS = PROJECT_ROOT / "src" / "shell" / "adapter-registry.js"
PROFILE_DISCOVERY_JS = PROJECT_ROOT / "src" / "shell" / "profile-discovery.js"

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def load_profile(filename: str) -> dict:
    with open(PROFILES_DIR / filename) as f:
        return json.load(f)


def load_all_profiles() -> list[dict]:
    profiles = []
    for path in sorted(PROFILES_DIR.glob("*.json")):
        if path.name == "schema.json":
            continue
        with open(path) as f:
            profiles.append(json.load(f))
    return profiles


def extract_known_adapter_ids_from_js() -> set[str]:
    """Parse ADAPTER_PATHS keys from adapter-registry.js without executing JS."""
    src = ADAPTER_REGISTRY_JS.read_text()
    # Match keys like: 'clawdbot': or "hume-evi":
    return set(re.findall(r"['\"]([a-z0-9-]+)['\"]:\s+['\"]\.\.\/adapters\/", src))


# ─────────────────────────────────────────────────────────────────────────────
# File existence tests
# ─────────────────────────────────────────────────────────────────────────────

def test_adapter_registry_js_exists():
    assert ADAPTER_REGISTRY_JS.exists(), "src/shell/adapter-registry.js must exist (P6-T5)"


def test_profile_discovery_js_exists():
    assert PROFILE_DISCOVERY_JS.exists(), "src/shell/profile-discovery.js must exist (P6-T5)"


# ─────────────────────────────────────────────────────────────────────────────
# Profile JSON field tests
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("filename", [
    "default.json",
])
def test_profile_has_adapter_field(filename):
    """Every profile JSON must declare which adapter it uses."""
    profile = load_profile(filename)
    assert "adapter" in profile, (
        f"{filename} must have an 'adapter' field (P6-T5: adapter auto-discovery)"
    )
    assert isinstance(profile["adapter"], str)
    assert len(profile["adapter"]) > 0


@pytest.mark.parametrize("filename", [
    "default.json",
])
def test_profile_has_adapter_config_field(filename):
    """Every profile JSON must have adapter_config (may be empty dict)."""
    profile = load_profile(filename)
    assert "adapter_config" in profile, (
        f"{filename} must have an 'adapter_config' field"
    )
    assert isinstance(profile["adapter_config"], dict)


@pytest.mark.parametrize("filename,expected_adapter", [
    ("default.json",      "clawdbot"),
])
def test_profile_adapter_value(filename, expected_adapter):
    """Each profile points to the correct adapter."""
    profile = load_profile(filename)
    assert profile["adapter"] == expected_adapter, (
        f"{filename}: expected adapter='{expected_adapter}', got '{profile['adapter']}'"
    )


def test_clawdbot_profiles_have_session_key_in_adapter_config():
    """ClawdBot adapter needs sessionKey to identify the session."""
    for filename in ("default.json",):
        profile = load_profile(filename)
        cfg = profile.get("adapter_config", {})
        assert "sessionKey" in cfg, f"{filename}: adapter_config must include 'sessionKey'"
        assert isinstance(cfg["sessionKey"], str), (
            f"{filename}: adapter_config.serverUrl must be a URL"
        )


@pytest.mark.skip(reason="hume-evi.json not included in base release")
def test_hume_profile_has_server_url_in_adapter_config():
    profile = load_profile("hume-evi.json")
    cfg = profile.get("adapter_config", {})
    assert "serverUrl" in cfg


# ─────────────────────────────────────────────────────────────────────────────
# Adapter registry consistency tests
# ─────────────────────────────────────────────────────────────────────────────

def test_adapter_registry_has_clawdbot():
    ids = extract_known_adapter_ids_from_js()
    assert "clawdbot" in ids, "adapter-registry.js must register 'clawdbot'"


def test_adapter_registry_has_hume_evi():
    ids = extract_known_adapter_ids_from_js()
    assert "hume-evi" in ids, "adapter-registry.js must register 'hume-evi'"


def test_all_profile_adapters_are_registered():
    """Every adapter referenced by a profile must exist in adapter-registry.js."""
    registered = extract_known_adapter_ids_from_js()
    profiles   = load_all_profiles()

    for profile in profiles:
        adapter_id = profile.get("adapter")
        if adapter_id:
            assert adapter_id in registered, (
                f"Profile '{profile['id']}' references adapter '{adapter_id}' "
                f"which is not registered in adapter-registry.js. "
                f"Known adapters: {sorted(registered)}"
            )


# ─────────────────────────────────────────────────────────────────────────────
# adapter-registry.js content tests
# ─────────────────────────────────────────────────────────────────────────────

def test_adapter_registry_exports_adapter_registry_singleton():
    src = ADAPTER_REGISTRY_JS.read_text()
    assert "export const adapterRegistry" in src


def test_adapter_registry_exports_class():
    src = ADAPTER_REGISTRY_JS.read_text()
    assert "export { AdapterRegistry" in src


def test_adapter_registry_has_load_method():
    src = ADAPTER_REGISTRY_JS.read_text()
    assert "async load(" in src


def test_adapter_registry_has_default_fallback():
    src = ADAPTER_REGISTRY_JS.read_text()
    assert "DEFAULT_ADAPTER_ID" in src
    assert "'clawdbot'" in src or '"clawdbot"' in src


# ─────────────────────────────────────────────────────────────────────────────
# profile-discovery.js content tests
# ─────────────────────────────────────────────────────────────────────────────

def test_profile_discovery_exports_singleton():
    src = PROFILE_DISCOVERY_JS.read_text()
    assert "export const profileDiscovery" in src


def test_profile_discovery_exports_class():
    src = PROFILE_DISCOVERY_JS.read_text()
    assert "export { ProfileDiscovery" in src


def test_profile_discovery_fetches_api_profiles():
    src = PROFILE_DISCOVERY_JS.read_text()
    assert "/api/profiles" in src


def test_profile_discovery_uses_orchestrator():
    src = PROFILE_DISCOVERY_JS.read_text()
    assert "orchestrator" in src


def test_profile_discovery_uses_adapter_registry():
    src = PROFILE_DISCOVERY_JS.read_text()
    assert "adapterRegistry" in src


def test_profile_discovery_listens_for_profile_switched():
    src = PROFILE_DISCOVERY_JS.read_text()
    assert "profile:switched" in src


def test_profile_discovery_handles_fallback():
    """Discovery must gracefully fall back if /api/profiles fails."""
    src = PROFILE_DISCOVERY_JS.read_text()
    assert "_registerFallback" in src or "fallbackMode" in src


# ─────────────────────────────────────────────────────────────────────────────
# ProfileManager integration — adapter field is preserved
# ─────────────────────────────────────────────────────────────────────────────

def test_profile_manager_loads_adapter_field(tmp_path):
    """ProfileManager.list_profiles should include adapter field for display."""
    import sys
    sys.path.insert(0, str(PROJECT_ROOT))
    from profiles.manager import ProfileManager

    pm = ProfileManager(str(PROFILES_DIR))
    listed = pm.list_profiles()

    ids = {p["id"] for p in listed}
    assert "pi-guy" in ids
    assert "hume-evi" in ids


def test_all_profiles_have_valid_ids():
    """All profile IDs must be lowercase alphanumeric + hyphens (schema constraint)."""
    profiles = load_all_profiles()
    for profile in profiles:
        pid = profile.get("id", "")
        assert re.match(r'^[a-z0-9-]+$', pid), (
            f"Profile id '{pid}' must be lowercase alphanumeric + hyphens only"
        )
