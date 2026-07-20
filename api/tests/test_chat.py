"""Tests for the AI navigator chat endpoint.

The endpoint's own job is to validate the request, drive the navigator, and serialise its
events as Server-Sent Events — so it is exercised with a fake navigator yielding scripted
events (the loop itself is covered in ``test_navigator``). One test uses the real dependency
wiring with no provider configured, to prove the pre-stream 400.
"""

from collections.abc import Iterator, Sequence

from fastapi.testclient import TestClient

from shirube.adapters.api.app import create_app
from shirube.adapters.api.dependencies import (
    get_ai_config_service,
    get_navigator_service,
    get_secret_store,
)
from shirube.application.ai_config import ProviderStatus
from shirube.domain.chat import (
    ChatMessage,
    NavigatorDone,
    NavigatorError,
    NavigatorEvent,
    NavigatorTextDelta,
    NavigatorToolCall,
    TokenUsage,
)


class FakeNavigator:
    """Stands in for NavigatorService, replaying scripted events and recording its call."""

    def __init__(self, events: Sequence[NavigatorEvent]) -> None:
        self._events = events
        self.calls: list[tuple[str, list[ChatMessage]]] = []

    def ask(self, profile_id: str, history: Sequence[ChatMessage]) -> Iterator[NavigatorEvent]:
        self.calls.append((profile_id, list(history)))
        yield from self._events


class FakeUnconfiguredConfigService:
    """An AiConfigService whose provider is not configured."""

    def get(self) -> ProviderStatus:
        return ProviderStatus(config=None, has_api_key=False)


class FakeSecretStore:
    """In-memory stand-in for the OS keychain (unused when unconfigured, but wired anyway)."""

    def get_password(self, key: str) -> str | None:
        return None

    def set_password(self, key: str, password: str) -> None:  # pragma: no cover - unused here
        pass

    def delete_password(self, key: str) -> None:  # pragma: no cover - unused here
        pass


def _client_with_navigator(navigator: FakeNavigator) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_navigator_service] = lambda: navigator
    return TestClient(app)


def _frames(body: str) -> list[tuple[str, str]]:
    """Parse an SSE body into (event, data) pairs."""
    pairs: list[tuple[str, str]] = []
    for block in body.strip().split("\n\n"):
        lines = block.splitlines()
        event = next(line.removeprefix("event: ") for line in lines if line.startswith("event: "))
        data = next(line.removeprefix("data: ") for line in lines if line.startswith("data: "))
        pairs.append((event, data))
    return pairs


def test_chat_streams_text_tool_and_done_frames() -> None:
    navigator = FakeNavigator(
        [
            NavigatorToolCall("search_objects"),
            NavigatorTextDelta("The store "),
            NavigatorTextDelta("table."),
            NavigatorDone(TokenUsage(input_tokens=120, output_tokens=18)),
        ]
    )
    with _client_with_navigator(navigator) as client:
        response = client.post(
            "/api/profiles/p1/chat",
            json={"messages": [{"role": "user", "content": "Where do stores live?"}]},
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    frames = _frames(response.text)
    assert frames == [
        ("tool_call", '{"name": "search_objects"}'),
        ("text", '{"text": "The store "}'),
        ("text", '{"text": "table."}'),
        ("done", '{"usage": {"input_tokens": 120, "output_tokens": 18}}'),
    ]
    # The request's profile and history reached the navigator.
    profile_id, history = navigator.calls[0]
    assert profile_id == "p1"
    assert [(m.role.value, m.content) for m in history] == [("user", "Where do stores live?")]


def test_chat_serialises_an_error_frame() -> None:
    navigator = FakeNavigator([NavigatorError("The AI provider could not be reached.")])
    with _client_with_navigator(navigator) as client:
        response = client.post(
            "/api/profiles/p1/chat",
            json={"messages": [{"role": "user", "content": "Hi"}]},
        )

    assert response.status_code == 200
    assert _frames(response.text) == [
        ("error", '{"message": "The AI provider could not be reached."}')
    ]


def test_chat_without_configured_provider_returns_400() -> None:
    app = create_app()
    app.dependency_overrides[get_ai_config_service] = FakeUnconfiguredConfigService
    app.dependency_overrides[get_secret_store] = FakeSecretStore
    with TestClient(app) as client:
        response = client.post(
            "/api/profiles/p1/chat",
            json={"messages": [{"role": "user", "content": "Hi"}]},
        )

    assert response.status_code == 400
    assert "provider" in response.json()["detail"].lower()


def test_chat_rejects_a_tool_role_in_history() -> None:
    navigator = FakeNavigator([NavigatorDone()])
    with _client_with_navigator(navigator) as client:
        response = client.post(
            "/api/profiles/p1/chat",
            json={"messages": [{"role": "tool", "content": "{}"}]},
        )

    assert response.status_code == 422
    assert navigator.calls == []


def test_chat_rejects_empty_history() -> None:
    navigator = FakeNavigator([NavigatorDone()])
    with _client_with_navigator(navigator) as client:
        response = client.post("/api/profiles/p1/chat", json={"messages": []})

    assert response.status_code == 422
    assert navigator.calls == []
