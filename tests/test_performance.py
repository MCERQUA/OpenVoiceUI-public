"""
Performance tests — P7-T2 Performance Audit
Ref: 14-QUICK-REFERENCE.md performance targets

These tests measure response time of HTTP endpoints using the Flask test client
and verify they meet the latency budgets set in the performance targets.

All tests use the CRITICAL thresholds (not the aspirational targets) because
the dominant bottleneck (LLM inference) is external to this service.
"""

import time
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def measure_latency(client, method: str, path: str, **kwargs) -> float:
    """Return wall-clock seconds for a single request to the test client."""
    t0 = time.perf_counter()
    if method.upper() == "GET":
        client.get(path, **kwargs)
    elif method.upper() == "POST":
        client.post(path, **kwargs)
    return time.perf_counter() - t0


def avg_latency(client, method: str, path: str, n: int = 5, **kwargs) -> float:
    """Return the average latency over n repetitions (seconds)."""
    times = [measure_latency(client, method, path, **kwargs) for _ in range(n)]
    return sum(times) / len(times)


# ---------------------------------------------------------------------------
# Performance targets (CRITICAL column from 14-QUICK-REFERENCE.md)
# ---------------------------------------------------------------------------

# Health / status endpoints should respond in well under 50ms each.
# We use 50ms as an absolute ceiling — anything slower indicates blocking I/O
# on the hot path.
HEALTH_ENDPOINT_CRITICAL_MS = 50

# Static JSON endpoints (session, memory-status) — no DB, no external calls
STATIC_ENDPOINT_CRITICAL_MS = 50

# Server-stats endpoint calls psutil — allow up to 600ms (interval=0.3 blocks)
SERVER_STATS_CRITICAL_MS = 600

# Refactor status — reads a JSON file from disk
REFACTOR_STATUS_CRITICAL_MS = 100


# ---------------------------------------------------------------------------
# Health endpoint latency
# ---------------------------------------------------------------------------

class TestHealthEndpointLatency:
    """Health probes must respond fast — they are polled by watchdogs."""

    def test_health_live_latency(self, client):
        """/health/live must respond within {HEALTH_ENDPOINT_CRITICAL_MS}ms."""
        avg = avg_latency(client, "GET", "/health/live")
        avg_ms = avg * 1000
        assert avg_ms < HEALTH_ENDPOINT_CRITICAL_MS, (
            f"/health/live avg latency {avg_ms:.1f}ms exceeds "
            f"{HEALTH_ENDPOINT_CRITICAL_MS}ms critical threshold"
        )

    def test_health_ready_latency(self, client):
        """/health/ready must respond within {HEALTH_ENDPOINT_CRITICAL_MS}ms."""
        avg = avg_latency(client, "GET", "/health/ready")
        avg_ms = avg * 1000
        assert avg_ms < HEALTH_ENDPOINT_CRITICAL_MS, (
            f"/health/ready avg latency {avg_ms:.1f}ms exceeds "
            f"{HEALTH_ENDPOINT_CRITICAL_MS}ms critical threshold"
        )

    def test_api_health_latency(self, client):
        """/api/health must respond within {HEALTH_ENDPOINT_CRITICAL_MS}ms."""
        avg = avg_latency(client, "GET", "/api/health")
        avg_ms = avg * 1000
        assert avg_ms < HEALTH_ENDPOINT_CRITICAL_MS, (
            f"/api/health avg latency {avg_ms:.1f}ms exceeds "
            f"{HEALTH_ENDPOINT_CRITICAL_MS}ms critical threshold"
        )


# ---------------------------------------------------------------------------
# Static / lightweight endpoint latency
# ---------------------------------------------------------------------------

class TestStaticEndpointLatency:
    """Endpoints that return in-memory or simple file data must be fast."""

    def test_session_endpoint_latency(self, client):
        """/api/session must respond within {STATIC_ENDPOINT_CRITICAL_MS}ms."""
        avg = avg_latency(client, "GET", "/api/session")
        avg_ms = avg * 1000
        assert avg_ms < STATIC_ENDPOINT_CRITICAL_MS, (
            f"/api/session avg latency {avg_ms:.1f}ms exceeds "
            f"{STATIC_ENDPOINT_CRITICAL_MS}ms threshold"
        )

    def test_memory_status_latency(self, client):
        """/api/memory-status must respond within {STATIC_ENDPOINT_CRITICAL_MS}ms."""
        avg = avg_latency(client, "GET", "/api/memory-status")
        avg_ms = avg * 1000
        assert avg_ms < STATIC_ENDPOINT_CRITICAL_MS, (
            f"/api/memory-status avg latency {avg_ms:.1f}ms exceeds "
            f"{STATIC_ENDPOINT_CRITICAL_MS}ms threshold"
        )

    def test_refactor_status_latency(self, client):
        """/api/refactor/status must respond within {REFACTOR_STATUS_CRITICAL_MS}ms."""
        avg = avg_latency(client, "GET", "/api/refactor/status")
        avg_ms = avg * 1000
        assert avg_ms < REFACTOR_STATUS_CRITICAL_MS, (
            f"/api/refactor/status avg latency {avg_ms:.1f}ms exceeds "
            f"{REFACTOR_STATUS_CRITICAL_MS}ms threshold"
        )


# ---------------------------------------------------------------------------
# Server-stats (psutil, expected to be ~300-500ms due to cpu_percent interval)
# ---------------------------------------------------------------------------

class TestServerStatsLatency:
    """server-stats calls psutil.cpu_percent(interval=0.3) — inherently slow."""

    def test_server_stats_latency(self, client):
        """/api/server-stats must respond within {SERVER_STATS_CRITICAL_MS}ms."""
        latency = measure_latency(client, "GET", "/api/server-stats")
        latency_ms = latency * 1000
        assert latency_ms < SERVER_STATS_CRITICAL_MS, (
            f"/api/server-stats latency {latency_ms:.1f}ms exceeds "
            f"{SERVER_STATS_CRITICAL_MS}ms threshold"
        )


# ---------------------------------------------------------------------------
# Session key caching (FIND-02 fix verification)
# ---------------------------------------------------------------------------

class TestSessionKeyCaching:
    """Verify that the session key cache (FIND-02 fix) works correctly."""

    def test_session_key_cache_hit_is_fast(self):
        """get_voice_session_key() should return cached value without file I/O."""
        from routes.conversation import get_voice_session_key, _session_key_cache
        # Warm the cache by calling once
        key1 = get_voice_session_key()
        # Measure cached call
        t0 = time.perf_counter()
        key2 = get_voice_session_key()
        elapsed_us = (time.perf_counter() - t0) * 1_000_000
        assert key1 == key2, "Cached key must match initial key"
        assert elapsed_us < 500, (
            f"Cached get_voice_session_key() took {elapsed_us:.0f}µs, "
            "expected <500µs (should be pure memory access)"
        )


# ---------------------------------------------------------------------------
# DB background writer (FIND-01 fix verification)
# ---------------------------------------------------------------------------

class TestDbBackgroundWriter:
    """Verify the DB write queue (FIND-01 fix) is set up correctly."""

    def test_db_write_queue_exists(self):
        """The background DB write queue should be importable and non-None."""
        from routes.conversation import _db_write_queue
        assert _db_write_queue is not None, (
            "_db_write_queue must exist (FIND-01 background-thread fix)"
        )

    def test_log_conversation_non_blocking(self):
        """log_conversation() should return almost immediately (enqueues, doesn't write)."""
        from routes.conversation import log_conversation
        t0 = time.perf_counter()
        log_conversation("user", "perf test message", session_id="perf-test")
        elapsed_ms = (time.perf_counter() - t0) * 1000
        assert elapsed_ms < 5, (
            f"log_conversation() took {elapsed_ms:.1f}ms — "
            "expected <5ms (should only enqueue, not write)"
        )


# ---------------------------------------------------------------------------
# Memory target verification (static check against process info)
# ---------------------------------------------------------------------------

class TestMemoryUsage:
    """Verify process memory stays within targets."""

    def test_process_memory_under_target(self):
        """The app process RSS must be under 500MB (target from 14-QUICK-REFERENCE.md)."""
        import os
        import psutil
        try:
            proc = psutil.Process(os.getpid())
            rss_mb = proc.memory_info().rss / 1024 / 1024
            assert rss_mb < 500, (
                f"Process RSS {rss_mb:.1f}MB exceeds 500MB target"
            )
        except (psutil.NoSuchProcess, ImportError):
            pytest.skip("psutil not available")


# ---------------------------------------------------------------------------
# WAL mode verification (from P1-T5)
# ---------------------------------------------------------------------------

class TestSQLiteWAL:
    """Verify SQLite WAL mode is enabled (required for concurrent access)."""

    def test_wal_mode_enabled(self):
        """usage.db must be in WAL journal mode."""
        import sqlite3
        import os
        db_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "usage.db"
        )
        if not os.path.exists(db_path):
            pytest.skip("usage.db not found")
        conn = sqlite3.connect(db_path)
        row = conn.execute("PRAGMA journal_mode;").fetchone()
        conn.close()
        assert row[0] == "wal", (
            f"usage.db journal_mode is '{row[0]}', expected 'wal' (P1-T5 WAL fix)"
        )
