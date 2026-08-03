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
    "kind": "postgresql",
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


def test_candidate_edit_uses_new_fields_and_the_stored_password() -> None:
    """A blank-password edit is tested with the new fields and the profile's stored password.

    This is what lets the form verify an edit before it overwrites the saved profile, without
    the client ever handling the secret.
    """
    connector = FakeConnector()
    secrets = FakeSecretStore()
    with _client(connector, secrets) as client:
        created = client.post("/api/profiles", json={**_PARAMS, "name": "staging"}).json()
        edit = {**_PARAMS, "name": "staging", "host": "new-host.example.com"}
        edit.pop("password")  # blank: keep the stored one
        response = client.post(f"/api/profiles/{created['id']}/test-edit", json=edit)

    assert response.status_code == 200
    # The new host is tested, with the password read from the keychain.
    assert connector.calls[0].host == "new-host.example.com"
    assert connector.calls[0].password == "s3cret"


def test_candidate_edit_uses_a_newly_entered_password() -> None:
    """A password supplied with the edit is used as-is, in preference to the stored one."""
    connector = FakeConnector()
    secrets = FakeSecretStore()
    with _client(connector, secrets) as client:
        created = client.post("/api/profiles", json={**_PARAMS, "name": "staging"}).json()
        edit = {**_PARAMS, "name": "staging", "password": "changed"}
        response = client.post(f"/api/profiles/{created['id']}/test-edit", json=edit)

    assert response.status_code == 200
    assert connector.calls[0].password == "changed"


def test_candidate_edit_does_not_persist_the_edit() -> None:
    """Testing a candidate edit must not change the saved profile — it only tests."""
    connector = FakeConnector(ConnectionFailedError("nope"))
    secrets = FakeSecretStore()
    with _client(connector, secrets) as client:
        created = client.post("/api/profiles", json={**_PARAMS, "name": "staging"}).json()
        edit = {**_PARAMS, "name": "renamed", "host": "new-host.example.com"}
        response = client.post(f"/api/profiles/{created['id']}/test-edit", json=edit)
        assert response.status_code == 400
        # The saved profile is untouched: neither the failed test's host nor name stuck.
        fetched = client.get(f"/api/profiles/{created['id']}").json()

    assert fetched["host"] == "db.example.com"
    assert fetched["name"] == "staging"


def test_candidate_edit_missing_profile_returns_404() -> None:
    with _client(FakeConnector()) as client:
        response = client.post(
            "/api/profiles/does-not-exist/test-edit",
            json={**_PARAMS, "name": "staging"},
        )

    assert response.status_code == 404
