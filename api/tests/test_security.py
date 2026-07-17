"""Security guarantees for the local web surface — the named, adversarial suite.

Ordinary tests assert that good things happen; these assert that bad things do *not*.
shirube advertises specific promises — a locked-down local surface, credentials that
stay in the keychain, logs that hold no data, errors that reveal no internals — so each
gets a test that would fail the moment a regression let it slip.

The database-backed guarantees (read-only, SQL-injection resistance) live in the
integration suite; everything provable without a database lives here.
"""

import logging
from collections.abc import Callable, Sequence

import pytest
from fastapi.testclient import TestClient

from shirube.adapters.api.app import create_app
from shirube.adapters.api.dependencies import (
    get_data_reader,
    get_schema_inspector,
    get_secret_store,
)
from shirube.domain.connection import ConnectionParams
from shirube.domain.data import RowPage, RowQuery
from shirube.domain.errors import ConnectionFailedError
from shirube.domain.schema import SchemaGraph

# A distinctive sentinel: if it ever turns up in a response body or the log, something
# leaked it. Unlikely to occur by chance, so a substring check is a reliable guard.
_SECRET = "pw-do-not-leak-8f3a2b1c"

_PROFILE = {
    "name": "shop",
    "host": "db.example.com",
    "port": 5432,
    "database": "shop",
    "username": "readonly",
    "password": _SECRET,
    "sslmode": "require",
    "schemas": ["public"],
}


class _FakeSecretStore:
    """In-memory stand-in for the OS keychain (CI has none)."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    def get_password(self, profile_id: str) -> str | None:
        return self._store.get(profile_id)

    def set_password(self, profile_id: str, password: str) -> None:
        self._store[profile_id] = password

    def delete_password(self, profile_id: str) -> None:
        self._store.pop(profile_id, None)


def _client(
    overrides: dict[Callable[..., object], Callable[..., object]] | None = None,
) -> TestClient:
    """An app whose secret store is faked, plus any extra dependency overrides."""
    app = create_app()
    app.dependency_overrides[get_secret_store] = _FakeSecretStore
    for dependency, override in (overrides or {}).items():
        app.dependency_overrides[dependency] = override
    return TestClient(app)


# --- Host validation and security headers (DNS-rebinding surface) ---------------------


def test_rejects_unrecognised_host_header() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/health", headers={"host": "evil.example.com"})

    # DNS-rebinding requests arrive with the attacker's own hostname — refused.
    assert response.status_code == 400


def test_accepts_a_loopback_host_header() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/health", headers={"host": "127.0.0.1:7472"})

    assert response.status_code == 200


def test_responses_carry_security_headers() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert "default-src 'self'" in response.headers["Content-Security-Policy"]
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]


# --- No CORS, ever (regression guard) -------------------------------------------------
#
# shirube is same-origin by design: the SPA and API share one origin, so no
# cross-origin access is ever wanted. Adding CORSMiddleware "to fix a fetch" would open
# the local API to any website the user visits — these fail loudly if that ever happens.


def test_no_cors_header_on_a_normal_request() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/health", headers={"Origin": "https://evil.example.com"})

    assert response.status_code == 200
    lower = {key.lower() for key in response.headers}
    assert "access-control-allow-origin" not in lower
    assert "access-control-allow-credentials" not in lower


def test_no_cors_headers_on_a_preflight() -> None:
    with TestClient(create_app()) as client:
        response = client.options(
            "/api/health",
            headers={
                "Origin": "https://evil.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )

    # With no CORS middleware, the preflight is simply not honoured (no allow-origin).
    assert "access-control-allow-origin" not in {key.lower() for key in response.headers}


# --- Credentials never leak -----------------------------------------------------------


def test_password_is_absent_from_profile_responses() -> None:
    with _client() as client:
        created = client.post("/api/profiles", json=_PROFILE)
        profile_id = created.json()["id"]
        fetched = client.get(f"/api/profiles/{profile_id}")
        listed = client.get("/api/profiles")

    # The response model has no password field, and the secret never appears anywhere.
    assert "password" not in created.json()
    assert _SECRET not in created.text
    assert _SECRET not in fetched.text
    assert _SECRET not in listed.text


def test_password_never_reaches_the_log(caplog: pytest.LogCaptureFixture) -> None:
    """A password sent to the connection tester never lands in the diagnostic log.

    Port 1 refuses at once, so this drives the real connect, error translation and error
    logging — the whole path the password travels — without needing a database.
    """
    with _client() as client, caplog.at_level(logging.DEBUG, logger="shirube"):
        response = client.post(
            "/api/connections/test",
            json={
                "host": "127.0.0.1",
                "port": 1,
                "database": "d",
                "username": "u",
                "password": _SECRET,
                "sslmode": "disable",
            },
        )

    assert response.status_code == 400
    # The failure was logged (positive control), but without the password in it.
    assert "/api/connections/test" in caplog.text
    assert _SECRET not in caplog.text


# --- Metadata-only logging ------------------------------------------------------------


class _FakeDataReader:
    """Returns a canned page; stands in for the row-reading adapter."""

    def read_rows(
        self,
        params: ConnectionParams,
        schemas: Sequence[str],
        object_id: str,
        query: RowQuery,
    ) -> RowPage:
        return RowPage(columns=("id",), rows=((1,),), has_more=False, offset=0, limit=100)


def test_filter_values_never_reach_the_log(caplog: pytest.LogCaptureFixture) -> None:
    """A distinctive filter value carried in a request body stays out of the log.

    The request logger records the method, path and status only; the object name in the
    path is metadata, but the *value* being filtered on is data and must not appear.
    """
    with (
        _client({get_data_reader: _FakeDataReader}) as client,
        caplog.at_level(logging.INFO, logger="shirube.request"),
    ):
        created = client.post("/api/profiles", json=_PROFILE)
        profile_id = created.json()["id"]
        response = client.post(
            f"/api/profiles/{profile_id}/objects/public.users/rows",
            json={"filters": [{"column": "email", "operator": "contains", "value": _SECRET}]},
        )

    assert response.status_code == 200
    assert "/rows -> 200" in caplog.text  # the request was logged...
    assert _SECRET not in caplog.text  # ...but the filter value was not


# --- No internal leakage on error -----------------------------------------------------


class _TranslatingInspector:
    """Fails the way the real adapter does: a clean message, a revealing cause."""

    def inspect(self, params: ConnectionParams, schemas: Sequence[str]) -> SchemaGraph:
        try:
            raise RuntimeError(f"dsn=postgresql://u:{_SECRET}@h/db running SELECT internal_col")
        except RuntimeError as cause:
            raise ConnectionFailedError("Could not reach the database.") from cause


def test_error_response_reveals_only_the_translated_message() -> None:
    with _client({get_schema_inspector: _TranslatingInspector}) as client:
        created = client.post("/api/profiles", json=_PROFILE)
        response = client.get(f"/api/profiles/{created.json()['id']}/schema")

    assert response.status_code == 400
    assert response.json() == {"detail": "Could not reach the database."}
    # Neither the raw cause (a DSN with the password, the internal SQL) leaks to the client.
    assert _SECRET not in response.text
    assert "internal_col" not in response.text


class _BuggyInspector:
    """Raises an unexpected error, as a genuine bug would."""

    def inspect(self, params: ConnectionParams, schemas: Sequence[str]) -> SchemaGraph:
        raise ValueError("unexpected boom, internal detail xyzzy-9021")


def test_unexpected_error_returns_a_generic_500_without_internals() -> None:
    app = create_app()
    app.dependency_overrides[get_secret_store] = _FakeSecretStore
    app.dependency_overrides[get_schema_inspector] = _BuggyInspector
    # Return the 500 rather than re-raising, so the response body can be inspected.
    with TestClient(app, raise_server_exceptions=False) as client:
        created = client.post("/api/profiles", json=_PROFILE)
        response = client.get(f"/api/profiles/{created.json()['id']}/schema")

    assert response.status_code == 500
    # The bug's message never reaches the client — only a generic error.
    assert "xyzzy-9021" not in response.text
