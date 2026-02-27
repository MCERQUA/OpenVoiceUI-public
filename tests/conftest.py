"""
pytest fixtures for ai-eyes2-refactor test suite.

ADR-010: pytest + Playwright for backend + E2E testing.

The Flask app (server.py) is a large monolith, so we test modules
in isolation where possible, and use a test client for endpoint tests.
"""

import os
import sys
import pytest

# Ensure project root is on sys.path so imports work
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


@pytest.fixture(scope="session")
def flask_app():
    """Return a configured Flask test app via the create_app() factory."""
    from app import create_app
    test_app, _sock = create_app(config_override={"TESTING": True})
    return test_app


@pytest.fixture(scope="session")
def client(flask_app):
    """Return a Flask test client."""
    return flask_app.test_client()


@pytest.fixture(scope="session")
def health_checker():
    """Return a HealthChecker instance for unit-testing health logic directly."""
    from health import HealthChecker
    return HealthChecker()


@pytest.fixture(scope="session")
def config():
    """Return the singleton config for testing config loading."""
    from config.loader import Config
    return Config()
