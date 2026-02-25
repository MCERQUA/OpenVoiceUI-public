"""
Tests for health probe logic (ADR-006, P1-T6).

We test the HealthChecker class directly (unit tests) rather than spinning
up the full server.py monolith.  The /health/live and /health/ready endpoints
delegate entirely to HealthChecker, so these tests cover their behaviour.
"""

import os
import pytest


class TestLiveness:
    """Liveness probe — should always return healthy=True."""

    def test_liveness_is_healthy(self, health_checker):
        result = health_checker.liveness()
        assert result.healthy is True

    def test_liveness_has_message(self, health_checker):
        result = health_checker.liveness()
        assert isinstance(result.message, str)
        assert len(result.message) > 0

    def test_liveness_has_uptime(self, health_checker):
        result = health_checker.liveness()
        assert result.details is not None
        assert "uptime_seconds" in result.details
        assert result.details["uptime_seconds"] >= 0


class TestReadiness:
    """Readiness probe — healthy only when Gateway env vars + TTS are set."""

    def test_readiness_returns_check_result(self, health_checker):
        """readiness() must return a CheckResult regardless of env state."""
        result = health_checker.readiness()
        assert hasattr(result, "healthy")
        assert hasattr(result, "message")
        assert hasattr(result, "details")

    def test_readiness_unhealthy_without_env(self, health_checker, monkeypatch):
        """Without Gateway env vars the probe must report unhealthy."""
        monkeypatch.delenv("CLAWDBOT_AUTH_TOKEN", raising=False)
        monkeypatch.delenv("CLAWDBOT_GATEWAY_URL", raising=False)
        result = health_checker.readiness()
        assert result.healthy is False

    def test_readiness_details_contains_gateway_key(self, health_checker):
        """details dict must include a 'gateway' sub-check."""
        result = health_checker.readiness()
        assert result.details is not None
        assert "gateway" in result.details

    def test_readiness_details_contains_tts_key(self, health_checker):
        """details dict must include a 'tts' sub-check."""
        result = health_checker.readiness()
        assert result.details is not None
        assert "tts" in result.details

    def test_readiness_healthy_when_gateway_configured(self, health_checker, monkeypatch):
        """When Gateway env vars are set and TTS loads, probe should be healthy."""
        monkeypatch.setenv("CLAWDBOT_AUTH_TOKEN", "test-token")
        monkeypatch.setenv("CLAWDBOT_GATEWAY_URL", "ws://127.0.0.1:18791")

        result = health_checker.readiness()
        # Gateway check should pass; TTS may or may not load in CI — only
        # assert the gateway sub-check is healthy.
        assert result.details["gateway"]["healthy"] is True
