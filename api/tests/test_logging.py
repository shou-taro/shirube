"""Tests for diagnostic logging.

The file handler is exercised directly, and the request/error logging is exercised
through the app with the ``caplog`` fixture standing in for the log's readers.
"""

import logging
from collections.abc import Iterator, Sequence

import pytest
from fastapi.testclient import TestClient

from shirube.adapters.api.app import create_app
from shirube.adapters.api.dependencies import get_schema_inspector, get_secret_store
from shirube.config import get_settings
from shirube.domain.connection import ConnectionParams
from shirube.domain.errors import ConnectionFailedError
from shirube.domain.schema import SchemaGraph
from shirube.logging_config import setup_logging

_PROFILE = {
    "name": "shop",
    "host": "db.example.com",
    "port": 5432,
    "database": "shop",
    "username": "readonly",
    "password": "s3cret",
    "sslmode": "require",
    "schemas": ["public"],
}


@pytest.fixture(autouse=True)
def _restore_shirube_logger() -> Iterator[None]:
    """Return the ``shirube`` logger to its default state after each test.

    Loggers are process-global, so a test that configures handlers or flips
    ``propagate`` must not leak that into the next (which relies on records reaching
    caplog's root handler).
    """
    yield
    logger = logging.getLogger("shirube")
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
    logger.propagate = True
    logger.setLevel(logging.NOTSET)


# --- file handler --------------------------------------------------------------------


def test_setup_logging_writes_to_the_log_file() -> None:
    logger = setup_logging()
    logging.getLogger("shirube.test").warning("hello from the test")
    for handler in logger.handlers:
        handler.flush()

    log_path = get_settings().log_path
    assert log_path.exists()
    assert "hello from the test" in log_path.read_text(encoding="utf-8")


# --- request and error logging -------------------------------------------------------


class _RaisingInspector:
    """A schema inspector that fails the way the real adapter does — with a cause."""

    def inspect(self, params: ConnectionParams, schemas: Sequence[str]) -> SchemaGraph:
        try:
            raise ValueError("boom root cause")
        except ValueError as cause:
            raise ConnectionFailedError("database unreachable") from cause


class _FakeSecretStore:
    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    def get_password(self, profile_id: str) -> str | None:
        return self._store.get(profile_id)

    def set_password(self, profile_id: str, password: str) -> None:
        self._store[profile_id] = password

    def delete_password(self, profile_id: str) -> None:
        self._store.pop(profile_id, None)


def _client() -> TestClient:
    app = create_app()
    secrets = _FakeSecretStore()
    app.dependency_overrides[get_schema_inspector] = _RaisingInspector
    app.dependency_overrides[get_secret_store] = lambda: secrets
    return TestClient(app)


def test_request_logging_records_method_path_and_status(caplog: pytest.LogCaptureFixture) -> None:
    with _client() as client, caplog.at_level(logging.INFO, logger="shirube.request"):
        response = client.get("/api/health")

    assert response.status_code == 200
    assert "GET /api/health -> 200" in caplog.text


def test_shirube_error_logs_the_underlying_cause(caplog: pytest.LogCaptureFixture) -> None:
    with _client() as client, caplog.at_level(logging.WARNING, logger="shirube.error"):
        created = client.post("/api/profiles", json=_PROFILE).json()
        response = client.get(f"/api/profiles/{created['id']}/schema")

    assert response.status_code == 400
    # The user-facing detail is logged, and so is the raw cause it was translated from.
    assert "database unreachable" in caplog.text
    assert "boom root cause" in caplog.text
