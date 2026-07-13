"""Tests for the connection-test endpoints.

A fake connector stands in for the real PostgreSQL adapter, so these exercise the API
and wiring without a live database; the real driver path is covered separately by the
error-translation unit tests.
"""

from fastapi.testclient import TestClient

from shirube.adapters.api.app import create_app
from shirube.adapters.api.dependencies import get_database_connector, get_secret_store
from shirube.domain.connection import ConnectionParams
from shirube.domain.errors import ConnectionFailedError

_PARAMS = {
    "host": "db.example.com",
    "port": 5432,
    "database": "shop",
    "username": "readonly",
    "password": "s3cret",
    "sslmode": "require",
}


class FakeConnector:
    """Records connection attempts and optionally fails with a given error."""

    def __init__(self, error: ConnectionFailedError | None = None) -> None:
        self._error = error
        self.calls: list[ConnectionParams] = []

    def test_connection(self, params: ConnectionParams) -> None:
        self.calls.append(params)
        if self._error is not None:
            raise self._error


class FakeSecretStore:
    """In-memory stand-in for the OS keychain."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    def get_password(self, profile_id: str) -> str | None:
        return self._store.get(profile_id)

    def set_password(self, profile_id: str, password: str) -> None:
        self._store[profile_id] = password

    def delete_password(self, profile_id: str) -> None:
        self._store.pop(profile_id, None)


def _client(connector: FakeConnector, secrets: FakeSecretStore | None = None) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_database_connector] = lambda: connector
    if secrets is not None:
        app.dependency_overrides[get_secret_store] = lambda: secrets
    return TestClient(app)


def test_ad_hoc_test_success() -> None:
    connector = FakeConnector()
    with _client(connector) as client:
        response = client.post("/api/connections/test", json=_PARAMS)

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert connector.calls[0].host == "db.example.com"


def test_ad_hoc_test_failure_returns_400() -> None:
    connector = FakeConnector(ConnectionFailedError("Could not reach db.example.com:5432."))
    with _client(connector) as client:
        response = client.post("/api/connections/test", json=_PARAMS)

    assert response.status_code == 400
    assert response.json()["detail"] == "Could not reach db.example.com:5432."


def test_profile_test_uses_stored_password() -> None:
    connector = FakeConnector()
    secrets = FakeSecretStore()
    with _client(connector, secrets) as client:
        created = client.post("/api/profiles", json={**_PARAMS, "name": "staging"}).json()
        response = client.post(f"/api/profiles/{created['id']}/test")

    assert response.status_code == 200
    assert connector.calls[0].password == "s3cret"


def test_profile_test_missing_returns_404() -> None:
    with _client(FakeConnector()) as client:
        response = client.post("/api/profiles/does-not-exist/test")

    assert response.status_code == 404
