"""Tests for the AI provider configuration endpoints.

The config repository runs against the per-test temporary SQLite database (see conftest),
while the keychain is replaced with an in-memory fake so the API key never touches the real
OS credential store. The key is checked to be stored and *never* returned.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from shirube.adapters.api.app import create_app
from shirube.adapters.api.dependencies import get_secret_store
from shirube.application.ai_config import AI_PROVIDER_SECRET_ID
from shirube.domain.errors import SecretStoreError


class FakeSecretStore:
    """In-memory stand-in for the OS keychain."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    def get_password(self, key: str) -> str | None:
        return self._store.get(key)

    def set_password(self, key: str, value: str) -> None:
        self._store[key] = value

    def delete_password(self, key: str) -> None:
        self._store.pop(key, None)


@pytest.fixture
def secrets() -> FakeSecretStore:
    return FakeSecretStore()


@pytest.fixture
def client(secrets: FakeSecretStore) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_secret_store] = lambda: secrets
    with TestClient(app) as test_client:
        yield test_client


def _claude() -> dict[str, object]:
    return {"kind": "anthropic", "model": "claude-opus-4-8", "api_key": "sk-secret"}


def _ollama() -> dict[str, object]:
    # A local OpenAI-compatible provider: base URL, no key.
    return {
        "kind": "openai_compatible",
        "model": "llama3.1",
        "base_url": "http://localhost:11434/v1",
    }


def test_unconfigured_returns_null(client: TestClient) -> None:
    response = client.get("/api/ai/provider")
    assert response.status_code == 200
    assert response.json() is None


def test_configure_hosted_stores_key_and_hides_it(
    client: TestClient,
    secrets: FakeSecretStore,
) -> None:
    response = client.put("/api/ai/provider", json=_claude())
    assert response.status_code == 200
    body = response.json()

    # The key is stored in the keychain but never echoed back.
    assert "api_key" not in body
    assert body == {
        "kind": "anthropic",
        "model": "claude-opus-4-8",
        "base_url": None,
        "has_api_key": True,
    }
    assert secrets.get_password(AI_PROVIDER_SECRET_ID) == "sk-secret"


def test_configure_local_needs_no_key(client: TestClient, secrets: FakeSecretStore) -> None:
    body = client.put("/api/ai/provider", json=_ollama()).json()

    assert body["kind"] == "openai_compatible"
    assert body["base_url"] == "http://localhost:11434/v1"
    assert body["has_api_key"] is False
    assert secrets.get_password(AI_PROVIDER_SECRET_ID) is None


def test_get_round_trips_after_put(client: TestClient) -> None:
    client.put("/api/ai/provider", json=_claude())
    fetched = client.get("/api/ai/provider").json()
    assert fetched["model"] == "claude-opus-4-8"
    assert fetched["has_api_key"] is True


def test_update_without_key_keeps_stored_key(
    client: TestClient,
    secrets: FakeSecretStore,
) -> None:
    client.put("/api/ai/provider", json=_claude())
    # Re-save with a changed model but no api_key — the stored key must survive.
    response = client.put(
        "/api/ai/provider",
        json={"kind": "anthropic", "model": "claude-sonnet-5"},
    )
    assert response.status_code == 200
    assert response.json()["model"] == "claude-sonnet-5"
    assert response.json()["has_api_key"] is True
    assert secrets.get_password(AI_PROVIDER_SECRET_ID) == "sk-secret"


def test_openai_compatible_requires_base_url(client: TestClient) -> None:
    response = client.put(
        "/api/ai/provider",
        json={"kind": "openai_compatible", "model": "gpt-4o"},
    )
    assert response.status_code == 400
    assert "base URL" in response.json()["detail"]


def test_blank_model_is_rejected(client: TestClient) -> None:
    response = client.put("/api/ai/provider", json={"kind": "anthropic", "model": "  "})
    assert response.status_code == 400


def test_anthropic_requires_an_api_key(client: TestClient) -> None:
    # Claude is hosted, so configuring it without a key (and none already stored) is refused.
    response = client.put(
        "/api/ai/provider",
        json={"kind": "anthropic", "model": "claude-opus-4-8"},
    )
    assert response.status_code == 400
    assert "API key" in response.json()["detail"]


def test_delete_unconfigures_and_removes_key(
    client: TestClient,
    secrets: FakeSecretStore,
) -> None:
    client.put("/api/ai/provider", json=_claude())

    assert client.delete("/api/ai/provider").status_code == 204
    assert client.get("/api/ai/provider").json() is None
    assert secrets.get_password(AI_PROVIDER_SECRET_ID) is None


class FailingSecretStore(FakeSecretStore):
    """A keychain whose writes fail — as a locked or unavailable OS keychain would."""

    def set_password(self, key: str, value: str) -> None:
        raise SecretStoreError


def test_configure_rolls_back_when_key_cannot_be_stored() -> None:
    """A keychain write failure must not leave a provider configured without its key."""
    failing = FailingSecretStore()
    app = create_app()
    app.dependency_overrides[get_secret_store] = lambda: failing
    with TestClient(app, raise_server_exceptions=False) as test_client:
        response = test_client.put("/api/ai/provider", json=_claude())
        assert response.status_code == 500
        # The config was rolled back, so nothing is configured.
        assert test_client.get("/api/ai/provider").json() is None
