"""
Health probe endpoints for liveness and readiness checks.
ADR-006: Separate liveness + readiness probes (Kubernetes-compatible).

Liveness  (/health/live)  — is the process running?
Readiness (/health/ready) — can it serve requests? (Gateway + TTS loaded)
"""

import os
import time
from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class CheckResult:
    healthy: bool
    message: str
    details: Optional[Dict] = field(default=None)


class HealthChecker:
    """Liveness and readiness health checks."""

    def __init__(self):
        self.start_time = time.time()

    def liveness(self) -> CheckResult:
        """Liveness probe — always 200 if the process is alive."""
        return CheckResult(
            healthy=True,
            message="Process is running",
            details={"uptime_seconds": round(time.time() - self.start_time, 1)},
        )

    def readiness(self) -> CheckResult:
        """Readiness probe — 200 only when Gateway configured + TTS loaded."""
        checks: Dict[str, Dict] = {}
        all_ok = True

        # --- Gateway check ---
        try:
            gateway_ok = _check_gateway()
            checks["gateway"] = gateway_ok.__dict__
            if not gateway_ok.healthy:
                all_ok = False
        except Exception as exc:
            checks["gateway"] = {"healthy": False, "message": str(exc)}
            all_ok = False

        # --- TTS providers check ---
        try:
            tts_ok = _check_tts()
            checks["tts"] = tts_ok.__dict__
            if not tts_ok.healthy:
                all_ok = False
        except Exception as exc:
            checks["tts"] = {"healthy": False, "message": str(exc)}
            all_ok = False

        return CheckResult(
            healthy=all_ok,
            message="All checks passed" if all_ok else "One or more checks failed",
            details=checks,
        )


# ---------------------------------------------------------------------------
# Individual check helpers
# ---------------------------------------------------------------------------

def _check_gateway() -> CheckResult:
    """Check that the Gateway auth token is configured."""
    token = os.getenv("CLAWDBOT_AUTH_TOKEN")
    if not token:
        return CheckResult(healthy=False, message="CLAWDBOT_AUTH_TOKEN not set")
    gateway_url = os.getenv("CLAWDBOT_GATEWAY_URL", "")
    if not gateway_url:
        return CheckResult(healthy=False, message="CLAWDBOT_GATEWAY_URL not set")
    return CheckResult(healthy=True, message="Gateway configured")


def _check_tts() -> CheckResult:
    """Check that at least one TTS provider is available."""
    try:
        from tts_providers import list_providers
        providers = list_providers()
        if not providers:
            return CheckResult(healthy=False, message="No TTS providers available")
        return CheckResult(
            healthy=True,
            message=f"{len(providers)} TTS provider(s) loaded",
            details={"providers": [str(p) for p in providers]},
        )
    except ImportError:
        return CheckResult(healthy=False, message="tts_providers module not importable")


# Module-level singleton — imported by server.py
health_checker = HealthChecker()
