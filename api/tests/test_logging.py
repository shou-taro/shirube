"""Tests for diagnostic logging.

Logging is structured: each event is a dict of fields, rendered as a colourised line on
the console and as one JSON object per line in the file. The file handler is exercised
directly (asserting the file really holds JSON), and the request/error logging is
exercised through the app with the ``caplog`` fixture standing in for the log's readers —
reading the structured fields off each captured record rather than a formatted string.
"""

import json
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


def _structured_events(caplog: pytest.LogCaptureFixture) -> list[dict[str, object]]:
    """Pull the structured event dicts off the records caplog captured.

    A structlog event reaches the standard library as a record whose ``msg`` is the event
    dict itself (structlog defers the final rendering to a handler formatter), so the
    fields can be read back straight from the record without parsing a string.
    """
    return [record.msg for record in caplog.records if isinstance(record.msg, dict)]


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


def test_setup_logging_writes_json_lines_to_the_log_file() -> None:
    setup_logging()
    logging.getLogger("shirube.test").warning("hello from the test")
    for handler in logging.getLogger("shirube").handlers:
        handler.flush()

    log_path = get_settings().log_path
    assert log_path.exists()

    # Every non-empty line is a self-contained JSON object carrying the event and its
    # level as fields — this is the machine-readable half of the structured setup.
    lines = [line for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    records = [json.loads(line) for line in lines]
    assert any(
        record.get("event") == "hello from the test" and record.get("level") == "warning"
        for record in records
    )


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
    events = _structured_events(caplog)
    assert any(
        event.get("event") == "request"
        and event.get("method") == "GET"
        and event.get("path") == "/api/health"
        and event.get("status") == 200
        for event in events
    )


def test_request_logging_binds_a_request_id(caplog: pytest.LogCaptureFixture) -> None:
    """Each request's log line carries a request_id, echoed back in a response header."""
    with _client() as client, caplog.at_level(logging.INFO, logger="shirube.request"):
        response = client.get("/api/health")

    header_id = response.headers["X-Request-ID"]
    request_events = [e for e in _structured_events(caplog) if e.get("event") == "request"]
    # The id in the log matches the one handed back to the caller, so a user-reported
    # request_id can be found in the log.
    assert any(event.get("request_id") == header_id for event in request_events)


def test_shirube_error_logs_the_underlying_cause(caplog: pytest.LogCaptureFixture) -> None:
    with _client() as client, caplog.at_level(logging.WARNING, logger="shirube.error"):
        created = client.post("/api/profiles", json=_PROFILE).json()
        response = client.get(f"/api/profiles/{created['id']}/schema")

    assert response.status_code == 400
    errors = [e for e in _structured_events(caplog) if e.get("event") == "request_error"]
    # The user-facing detail is logged, and so is the raw cause it was translated from.
    assert any(event.get("detail") == "database unreachable" for event in errors)
    assert any("boom root cause" in str(event.get("cause")) for event in errors)
