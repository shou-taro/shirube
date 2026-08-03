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
from shirube.application.ai_config import AI_PROVIDER_SECRET_ID, AiConfigService
from shirube.domain.ai import AiProviderConfig, AiProviderKind
from shirube.domain.errors import ProviderCheckError, SecretStoreError


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
        "context_window": None,
        "has_api_key": True,
    }
    assert secrets.get_password(AI_PROVIDER_SECRET_ID) == "sk-secret"


def test_configure_local_needs_no_key(client: TestClient, secrets: FakeSecretStore) -> None:
    body = client.put("/api/ai/provider", json=_ollama()).json()

    assert body["kind"] == "openai_compatible"
    assert body["base_url"] == "http://localhost:11434/v1"
    assert body["context_window"] is None
    assert body["has_api_key"] is False
    assert secrets.get_password(AI_PROVIDER_SECRET_ID) is None


def test_context_window_round_trips(client: TestClient) -> None:
    # A local model's window is stored and returned so the navigator can trim history to it.
    client.put("/api/ai/provider", json={**_ollama(), "context_window": 8192})

    fetched = client.get("/api/ai/provider").json()
    assert fetched["context_window"] == 8192


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


def test_test_provider_returns_ok_on_success(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A reachable provider returns {"ok": true} without saving anything."""
    monkeypatch.setattr(
        "shirube.adapters.api.routes.ai.check_provider",
        lambda config, api_key: None,
    )
    response = client.post("/api/ai/provider/test", json=_ollama())
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    # Testing must not configure the provider.
    assert client.get("/api/ai/provider").json() is None


def test_test_provider_reports_a_failure(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _fail(config: AiProviderConfig, api_key: str | None) -> None:
        raise ProviderCheckError("The provider rejected the API key.")

    monkeypatch.setattr("shirube.adapters.api.routes.ai.check_provider", _fail)
    response = client.post("/api/ai/provider/test", json=_claude())
    assert response.status_code == 400
    assert "rejected the API key" in response.json()["detail"]


def test_test_provider_reuses_the_stored_key_for_the_same_destination(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Re-testing the saved provider without re-entering the key uses the stored one."""
    client.put("/api/ai/provider", json=_claude())  # stores sk-secret for Claude
    seen: dict[str, object] = {}
    monkeypatch.setattr(
        "shirube.adapters.api.routes.ai.check_provider",
        lambda config, api_key: seen.update(api_key=api_key),
    )
    # Same destination (Claude), no api_key → the stored key is reused.
    response = client.post(
        "/api/ai/provider/test",
        json={"kind": "anthropic", "model": "claude-opus-4-8"},
    )
    assert response.status_code == 200
    assert seen["api_key"] == "sk-secret"


def test_test_provider_does_not_reuse_a_key_for_a_different_destination(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A key saved for one provider is never sent to a different endpoint the user typed in."""
    client.put("/api/ai/provider", json=_claude())  # stores sk-secret for Claude
    seen: dict[str, object] = {}
    monkeypatch.setattr(
        "shirube.adapters.api.routes.ai.check_provider",
        lambda config, api_key: seen.update(api_key=api_key),
    )
    # A different destination (a custom OpenAI-compatible URL), no key supplied.
    response = client.post(
        "/api/ai/provider/test",
        json={
            "kind": "openai_compatible",
            "model": "gpt-4o",
            "base_url": "https://elsewhere.example/v1",
        },
    )
    assert response.status_code == 200
    # The Claude key must NOT be reused for the custom endpoint.
    assert seen["api_key"] is None


def test_provider_models_returns_the_listed_ids(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The picker endpoint returns the provider's models without saving anything."""
    monkeypatch.setattr(
        "shirube.adapters.api.routes.ai.list_provider_models",
        lambda config, api_key: ["llama3.1", "qwen2.5"],
    )
    response = client.post("/api/ai/provider/models", json=_ollama())
    assert response.status_code == 200
    assert response.json() == {"models": ["llama3.1", "qwen2.5"]}
    # Listing must not configure the provider.
    assert client.get("/api/ai/provider").json() is None


def test_provider_models_reports_a_failure(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A provider that cannot list its models surfaces the translated error as a 400."""

    def _fail(config: AiProviderConfig, api_key: str | None) -> list[str]:
        raise ProviderCheckError("The provider rejected the API key.")

    monkeypatch.setattr("shirube.adapters.api.routes.ai.list_provider_models", _fail)
    response = client.post("/api/ai/provider/models", json=_claude())
    assert response.status_code == 400
    assert "rejected the API key" in response.json()["detail"]


def test_provider_models_reuses_the_stored_key_for_the_same_destination(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Listing the saved provider without re-entering the key uses the stored one."""
    client.put("/api/ai/provider", json=_claude())  # stores sk-secret for Claude
    seen: dict[str, object] = {}
    monkeypatch.setattr(
        "shirube.adapters.api.routes.ai.list_provider_models",
        lambda config, api_key: seen.update(api_key=api_key) or [],
    )
    # Same destination (Claude), no api_key → the stored key is reused.
    response = client.post(
        "/api/ai/provider/models",
        json={"kind": "anthropic", "model": "claude-opus-4-8"},
    )
    assert response.status_code == 200
    assert seen["api_key"] == "sk-secret"


def test_provider_models_does_not_reuse_a_key_for_a_different_destination(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Listing a different endpoint's models must not send it the saved provider's key."""
    client.put("/api/ai/provider", json=_claude())  # stores sk-secret for Claude
    seen: dict[str, object] = {}
    monkeypatch.setattr(
        "shirube.adapters.api.routes.ai.list_provider_models",
        lambda config, api_key: seen.update(api_key=api_key) or [],
    )
    # The reported leak: switch to a custom OpenAI-compatible URL, blank key, list its models.
    response = client.post(
        "/api/ai/provider/models",
        json={
            "kind": "openai_compatible",
            "model": "gpt-4o",
            "base_url": "https://elsewhere.example/v1",
        },
    )
    assert response.status_code == 200
    assert seen["api_key"] is None


def test_changing_destination_without_a_key_drops_the_old_key(
    client: TestClient,
    secrets: FakeSecretStore,
) -> None:
    """Saving a new destination with no key removes the key that belonged to the old one."""
    client.put("/api/ai/provider", json=_claude())
    assert secrets.get_password(AI_PROVIDER_SECRET_ID) == "sk-secret"

    # Switch to a local Ollama (needs no key). The Anthropic key must not linger.
    response = client.put("/api/ai/provider", json=_ollama())

    assert response.status_code == 200
    assert response.json()["has_api_key"] is False
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


class _MemoryConfigRepo:
    """In-memory AiConfigRepository for testing the service without a database."""

    def __init__(self) -> None:
        self._config: AiProviderConfig | None = None

    def get(self) -> AiProviderConfig | None:
        return self._config

    def set(self, config: AiProviderConfig) -> None:
        self._config = config

    def clear(self) -> None:
        self._config = None


def test_set_restores_the_previous_config_when_the_key_write_fails() -> None:
    """A failed key write over an existing provider rolls back to it, not to nothing."""
    repo = _MemoryConfigRepo()
    repo.set(AiProviderConfig(AiProviderKind.ANTHROPIC, "claude-opus-4-8", None))
    service = AiConfigService(repo, FailingSecretStore())  # type: ignore[arg-type]

    with pytest.raises(SecretStoreError):
        service.set(AiProviderConfig(AiProviderKind.ANTHROPIC, "claude-sonnet-5", None), "sk-new")

    # The prior configuration survives intact rather than being cleared.
    restored = repo.get()
    assert restored is not None
    assert restored.model == "claude-opus-4-8"
