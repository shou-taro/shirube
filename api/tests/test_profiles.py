"""Tests for the connection-profile endpoints.

The repository runs against the per-test temporary SQLite database (see conftest),
while the keychain is replaced with an in-memory fake so tests never touch the real OS
credential store.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from shirube.adapters.api.app import create_app
from shirube.adapters.api.dependencies import get_secret_store
from shirube.domain.errors import SecretStoreError


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


@pytest.fixture
def secrets() -> FakeSecretStore:
    return FakeSecretStore()


@pytest.fixture
def client(secrets: FakeSecretStore) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_secret_store] = lambda: secrets
    with TestClient(app) as test_client:
        yield test_client


def _new_profile() -> dict[str, object]:
    return {
        "name": "staging DB",
        "host": "db.example.com",
        "port": 5432,
        "database": "shop_production",
        "username": "readonly",
        "password": "s3cret",
        "sslmode": "require",
        "schemas": ["public"],
    }


def test_create_stores_password_and_hides_it(client: TestClient, secrets: FakeSecretStore) -> None:
    response = client.post("/api/profiles", json=_new_profile())
    assert response.status_code == 201
    body = response.json()

    assert "password" not in body
    assert body["name"] == "staging DB"
    assert secrets.get_password(body["id"]) == "s3cret"


def test_list_and_get(client: TestClient) -> None:
    created = client.post("/api/profiles", json=_new_profile()).json()

    listed = client.get("/api/profiles").json()
    assert len(listed) == 1

    fetched = client.get(f"/api/profiles/{created['id']}").json()
    assert fetched["id"] == created["id"]
    assert fetched["schemas"] == ["public"]


def test_update_without_password_keeps_it(client: TestClient, secrets: FakeSecretStore) -> None:
    created = client.post("/api/profiles", json=_new_profile()).json()

    renamed = {**_new_profile(), "name": "renamed"}
    renamed.pop("password")
    response = client.put(f"/api/profiles/{created['id']}", json=renamed)

    assert response.status_code == 200
    assert response.json()["name"] == "renamed"
    assert secrets.get_password(created["id"]) == "s3cret"


def test_delete_removes_profile_and_password(client: TestClient, secrets: FakeSecretStore) -> None:
    created = client.post("/api/profiles", json=_new_profile()).json()

    assert client.delete(f"/api/profiles/{created['id']}").status_code == 204
    assert secrets.get_password(created["id"]) is None
    assert client.get(f"/api/profiles/{created['id']}").status_code == 404


def test_get_missing_returns_404(client: TestClient) -> None:
    assert client.get("/api/profiles/does-not-exist").status_code == 404


class FailingSecretStore(FakeSecretStore):
    """A keychain whose writes fail — as a locked or unavailable OS keychain would."""

    def set_password(self, profile_id: str, password: str) -> None:
        raise SecretStoreError


def test_create_rolls_back_the_profile_when_the_password_cannot_be_stored() -> None:
    """A keychain write failure must not leave a saved-but-passwordless profile behind."""
    failing = FailingSecretStore()
    app = create_app()
    app.dependency_overrides[get_secret_store] = lambda: failing
    with TestClient(app, raise_server_exceptions=False) as test_client:
        response = test_client.post("/api/profiles", json=_new_profile())
        assert response.status_code == 500
        # The profile was rolled back, so nothing is listed.
        assert test_client.get("/api/profiles").json() == []
