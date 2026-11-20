"""Contract tests: the AI adapters driven through the real ``anthropic``/``openai`` SDKs.

``test_ai_adapters`` exercises the translation with fake SDK objects, and the live navigator
test (``integration/test_live_navigator``) is skipped unless a provider is configured — so
neither catches an SDK release that changes how a request is sent or a stream is parsed (the
streaming helpers, request options, exception types). These tests serve hand-written,
wire-format responses from a local HTTP server and let the real SDK do the rest.

What they do **not** prove is compatibility with the real APIs: the canned responses are
fixed, so a change on the provider's side would go unnoticed here. They guard the
adapter-to-SDK seam, chiefly across SDK upgrades.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from shirube.adapters.ai.anthropic_provider import AnthropicProvider
from shirube.adapters.ai.openai_provider import OpenAiCompatibleProvider
from shirube.domain.chat import (
    ChatRole,
    TextDelta,
    TokenUsage,
    ToolCall,
    ToolDefinition,
    ToolUse,
    TurnComplete,
    TurnMessage,
    TurnRequest,
)
from shirube.domain.errors import ProviderCheckError, ProviderRequestError

_REQUEST = TurnRequest(
    system="You are the navigator.",
    messages=(
        TurnMessage(ChatRole.USER, "Where does store live?"),
        TurnMessage(
            ChatRole.ASSISTANT,
            "Let me look.",
            tool_calls=(ToolCall("c1", "search_objects", {"query": "store"}),),
        ),
        TurnMessage(ChatRole.TOOL, '{"results": []}', tool_call_id="c1"),
    ),
    tools=(
        ToolDefinition(
            "search_objects",
            "Find objects.",
            {"type": "object", "properties": {"query": {"type": "string"}}},
        ),
    ),
)

# One turn that streams text, then a tool call whose arguments arrive in fragments.
_EXPECTED_EVENTS = [
    TextDelta("Let me "),
    TextDelta("check."),
    ToolUse("call_1", "search_objects", {"query": "store"}),
    TurnComplete("tool_use", TokenUsage(input_tokens=42, output_tokens=17)),
]


def _sse(events: list[tuple[str | None, Any]]) -> bytes:
    out = []
    for name, data in events:
        if name:
            out.append(f"event: {name}\n")
        payload = data if isinstance(data, str) else json.dumps(data)
        out.append(f"data: {payload}\n\n")
    return "".join(out).encode()


def _anthropic_block(event: str, index: int, **fields: Any) -> tuple[str, dict[str, Any]]:
    return event, {"type": event, "index": index, **fields}


_ANTHROPIC_STREAM = _sse(
    [
        (
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": "msg_1",
                    "type": "message",
                    "role": "assistant",
                    "model": "claude-test",
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": 42, "output_tokens": 1},
                },
            },
        ),
        _anthropic_block("content_block_start", 0, content_block={"type": "text", "text": ""}),
        _anthropic_block("content_block_delta", 0, delta={"type": "text_delta", "text": "Let me "}),
        _anthropic_block("content_block_delta", 0, delta={"type": "text_delta", "text": "check."}),
        _anthropic_block("content_block_stop", 0),
        _anthropic_block(
            "content_block_start",
            1,
            content_block={
                "type": "tool_use",
                "id": "call_1",
                "name": "search_objects",
                "input": {},
            },
        ),
        _anthropic_block(
            "content_block_delta",
            1,
            delta={"type": "input_json_delta", "partial_json": '{"query": '},
        ),
        _anthropic_block(
            "content_block_delta",
            1,
            delta={"type": "input_json_delta", "partial_json": '"store"}'},
        ),
        _anthropic_block("content_block_stop", 1),
        (
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": "tool_use", "stop_sequence": None},
                "usage": {"output_tokens": 17},
            },
        ),
        ("message_stop", {"type": "message_stop"}),
    ]
)


def _openai_chunk(
    delta: dict[str, Any] | None = None,
    finish_reason: str | None = None,
    usage: dict[str, int] | None = None,
) -> tuple[None, dict[str, Any]]:
    choices = (
        [] if delta is None else [{"index": 0, "delta": delta, "finish_reason": finish_reason}]
    )
    chunk = {
        "id": "chatcmpl-1",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "llama3.1",
        "choices": choices,
        "usage": usage,
    }
    return None, chunk


def _openai_tool_delta(**function: str) -> dict[str, Any]:
    call: dict[str, Any] = {"index": 0, "function": function}
    if "name" in function:
        call.update(id="call_1", type="function")
    return {"tool_calls": [call]}


_OPENAI_STREAM = _sse(
    [
        _openai_chunk({"role": "assistant", "content": "Let me "}),
        _openai_chunk({"content": "check."}),
        _openai_chunk(_openai_tool_delta(name="search_objects", arguments='{"query')),
        _openai_chunk(_openai_tool_delta(arguments='": "store"}')),
        _openai_chunk({}, finish_reason="tool_calls"),
        _openai_chunk(usage={"prompt_tokens": 42, "completion_tokens": 17, "total_tokens": 59}),
        (None, "[DONE]"),
    ]
)

# How other OpenAI-compatible servers differ from the platform, each on a path the adapter
# has its own branch for. A local runner or gateway may ignore ``stream_options`` and send no
# usage chunk; send a tool call whole, in one chunk with its finish reason and without an id;
# or stop at the output cap (``length``) mid-answer.
_OPENAI_VARIANTS = {
    "no-usage": _sse(
        [
            _openai_chunk({"role": "assistant", "content": "Let me "}),
            _openai_chunk({"content": "check."}),
            _openai_chunk(_openai_tool_delta(name="search_objects", arguments='{"query')),
            _openai_chunk(_openai_tool_delta(arguments='": "store"}')),
            _openai_chunk({}, finish_reason="tool_calls"),
            (None, "[DONE]"),
        ]
    ),
    "whole-call": _sse(
        [
            _openai_chunk({"role": "assistant", "content": "Let me "}),
            _openai_chunk({"content": "check."}),
            _openai_chunk(
                {
                    "tool_calls": [
                        {
                            "index": 0,
                            "type": "function",
                            "function": {
                                "name": "search_objects",
                                "arguments": '{"query": "store"}',
                            },
                        }
                    ]
                },
                finish_reason="tool_calls",
            ),
            (None, "[DONE]"),
        ]
    ),
    "truncated": _sse(
        [
            _openai_chunk({"role": "assistant", "content": "The store table "}),
            _openai_chunk({}, finish_reason="length"),
            _openai_chunk(usage={"prompt_tokens": 42, "completion_tokens": 8, "total_tokens": 50}),
            (None, "[DONE]"),
        ]
    ),
}

_ANTHROPIC_MODELS = {
    "data": [
        {"id": m, "type": "model", "display_name": m, "created_at": "2026-01-01T00:00:00Z"}
        for m in ("claude-a", "claude-b")
    ],
    "has_more": False,
    "first_id": "claude-a",
    "last_id": "claude-b",
}
_OPENAI_MODELS = {
    "object": "list",
    "data": [{"id": "llama3.1", "object": "model", "created": 0, "owned_by": "local"}],
}
# What the OpenAI platform answers when a reasoning model is sent the legacy output cap.
_UNSUPPORTED_MAX_TOKENS = {
    "error": {
        "message": "Unsupported parameter: 'max_tokens' is not supported with this model. "
        "Use 'max_completion_tokens' instead.",
        "type": "invalid_request_error",
        "param": "max_tokens",
        "code": "unsupported_parameter",
    }
}
_MODEL_NOT_FOUND = {
    "error": {
        "message": "The model `gpt-nope` does not exist or you do not have access to it.",
        "type": "invalid_request_error",
        "param": None,
        "code": "model_not_found",
    }
}
_ANTHROPIC_INVALID = {
    "type": "error",
    "error": {"type": "invalid_request_error", "message": "model: claude-nope not found"},
}
_UNAUTHORIZED = {
    "type": "error",
    "error": {"type": "authentication_error", "message": "invalid api key"},
}

# Paths below the server root: the Anthropic SDK appends ``/v1/...`` to its base URL, the
# OpenAI one is given ``/openai/v1`` as its base. ``/rejected`` answers everything with 401;
# ``/strict`` behaves like a reasoning model, refusing ``max_tokens``; ``/missing`` answers a
# completion with 404 model-not-found, and ``/invalid`` a Messages call with 400;
# ``/variant/<name>`` streams one of :data:`_OPENAI_VARIANTS`. Every POST
# body is also kept under ``<path>#<n>`` (counting from 1) so a retried request can be
# inspected.
_GET_ROUTES: dict[str, dict[str, Any]] = {
    "/v1/models": _ANTHROPIC_MODELS,
    "/openai/v1/models": _OPENAI_MODELS,
}
_STREAM_ROUTES = {
    "/v1/messages": _ANTHROPIC_STREAM,
    "/openai/v1/chat/completions": _OPENAI_STREAM,
}


class _FakeProvider(BaseHTTPRequestHandler):
    requests: dict[str, dict[str, Any]]

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _reply(self, status: int, body: bytes, content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 — http.server's naming
        if self.path.startswith("/rejected"):
            self._reply(401, json.dumps(_UNAUTHORIZED).encode())
        elif self.path in _GET_ROUTES:
            self._reply(200, json.dumps(_GET_ROUTES[self.path]).encode())
        else:
            self._reply(404, b"{}")

    def do_POST(self) -> None:  # noqa: N802 — http.server's naming
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        self.requests[self.path] = body
        count = sum(1 for key in self.requests if key.startswith(f"{self.path}#")) + 1
        self.requests[f"{self.path}#{count}"] = body
        if self.path == "/strict/v1/chat/completions":
            if "max_tokens" in body:
                self._reply(400, json.dumps(_UNSUPPORTED_MAX_TOKENS).encode())
            else:
                self._reply(200, _OPENAI_STREAM, "text/event-stream")
        elif self.path.startswith("/variant/"):
            name = self.path.split("/")[2]
            self._reply(200, _OPENAI_VARIANTS[name], "text/event-stream")
        elif self.path == "/invalid/v1/messages":
            self._reply(400, json.dumps(_ANTHROPIC_INVALID).encode())
        elif self.path == "/missing/v1/chat/completions":
            self._reply(404, json.dumps(_MODEL_NOT_FOUND).encode())
        elif self.path in _STREAM_ROUTES:
            self._reply(200, _STREAM_ROUTES[self.path], "text/event-stream")
        else:
            self._reply(404, b"{}")


@pytest.fixture
def server() -> Iterator[tuple[str, dict[str, dict[str, Any]]]]:
    """A local fake provider: yields its base URL and the request bodies it received."""
    received: dict[str, dict[str, Any]] = {}
    handler = type("Handler", (_FakeProvider,), {"requests": received})
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}", received
    finally:
        httpd.shutdown()
        httpd.server_close()


# --- Anthropic -----------------------------------------------------------------------


def test_anthropic_streams_a_turn_through_the_sdk(server: tuple[str, dict[str, Any]]) -> None:
    base_url, received = server
    provider = AnthropicProvider("claude-test", api_key="k", base_url=base_url)

    assert list(provider.stream_turn(_REQUEST)) == _EXPECTED_EVENTS

    sent = received["/v1/messages"]
    assert sent["stream"] is True
    assert sent["model"] == "claude-test"
    assert sent["system"] == "You are the navigator."
    assert [tool["name"] for tool in sent["tools"]] == ["search_objects"]
    assert [m["role"] for m in sent["messages"]] == ["user", "assistant", "user"]


def test_anthropic_lists_models_through_the_sdk(server: tuple[str, dict[str, Any]]) -> None:
    base_url, _ = server
    provider = AnthropicProvider("claude-test", api_key="k", base_url=base_url)

    assert provider.list_models() == ["claude-a", "claude-b"]


def test_anthropic_rejected_key_becomes_a_check_error(
    server: tuple[str, dict[str, Any]],
) -> None:
    base_url, _ = server
    provider = AnthropicProvider("claude-test", api_key="bad", base_url=f"{base_url}/rejected")

    with pytest.raises(ProviderCheckError, match="rejected the API key"):
        provider.list_models()


def test_anthropic_request_error_carries_the_providers_reason(
    server: tuple[str, dict[str, Any]],
) -> None:
    base_url, _ = server
    provider = AnthropicProvider("claude-nope", api_key="k", base_url=f"{base_url}/invalid")

    with pytest.raises(ProviderRequestError) as caught:
        list(provider.stream_turn(_REQUEST))

    assert caught.value.detail == "The AI provider returned an error: model: claude-nope not found"


# --- OpenAI-compatible ---------------------------------------------------------------


def test_openai_streams_a_turn_through_the_sdk(server: tuple[str, dict[str, Any]]) -> None:
    base_url, received = server
    provider = OpenAiCompatibleProvider(
        "llama3.1", base_url=f"{base_url}/openai/v1", max_tokens=512
    )

    assert list(provider.stream_turn(_REQUEST)) == _EXPECTED_EVENTS

    sent = received["/openai/v1/chat/completions"]
    assert sent["stream"] is True
    assert sent["stream_options"] == {"include_usage": True}
    assert sent["max_tokens"] == 512
    assert [tool["function"]["name"] for tool in sent["tools"]] == ["search_objects"]
    assert [m["role"] for m in sent["messages"]] == ["system", "user", "assistant", "tool"]


def test_openai_lists_models_through_the_sdk(server: tuple[str, dict[str, Any]]) -> None:
    base_url, _ = server
    provider = OpenAiCompatibleProvider("llama3.1", base_url=f"{base_url}/openai/v1")

    assert provider.list_models() == ["llama3.1"]


def test_openai_rejected_key_becomes_a_check_error(server: tuple[str, dict[str, Any]]) -> None:
    base_url, _ = server
    provider = OpenAiCompatibleProvider("llama3.1", base_url=f"{base_url}/rejected/v1")

    with pytest.raises(ProviderCheckError, match="rejected the API key"):
        provider.list_models()


def test_openai_switches_the_cap_name_when_the_endpoint_refuses_max_tokens(
    server: tuple[str, dict[str, Any]],
) -> None:
    # A gateway in front of a reasoning model rejects ``max_tokens`` with a 400, as the OpenAI
    # platform does; the adapter retries once with ``max_completion_tokens`` and keeps it.
    base_url, received = server
    provider = OpenAiCompatibleProvider("gpt-5", base_url=f"{base_url}/strict/v1", max_tokens=512)
    path = "/strict/v1/chat/completions"

    assert list(provider.stream_turn(_REQUEST)) == _EXPECTED_EVENTS
    assert received[f"{path}#1"]["max_tokens"] == 512
    assert received[f"{path}#2"]["max_completion_tokens"] == 512
    assert "max_tokens" not in received[f"{path}#2"]

    # The next turn goes straight to the accepted name: one request, no second rejection.
    assert list(provider.stream_turn(_REQUEST)) == _EXPECTED_EVENTS
    assert f"{path}#4" not in received
    assert received[f"{path}#3"]["max_completion_tokens"] == 512


def test_openai_request_error_carries_the_providers_reason(
    server: tuple[str, dict[str, Any]],
) -> None:
    base_url, _ = server
    provider = OpenAiCompatibleProvider("gpt-nope", base_url=f"{base_url}/missing/v1")

    with pytest.raises(ProviderRequestError) as caught:
        list(provider.stream_turn(_REQUEST))

    # Only the provider's message, not the SDK's "Error code: 404 - {...}" wrapping.
    assert caught.value.detail == (
        "The AI provider returned an error: "
        "The model `gpt-nope` does not exist or you do not have access to it."
    )


def _variant(base_url: str, name: str) -> OpenAiCompatibleProvider:
    return OpenAiCompatibleProvider("llama3.1", base_url=f"{base_url}/variant/{name}/v1")


def test_openai_tolerates_a_server_that_reports_no_usage(
    server: tuple[str, dict[str, Any]],
) -> None:
    # ``stream_options`` ignored: the turn completes with zero usage rather than failing.
    base_url, _ = server

    assert list(_variant(base_url, "no-usage").stream_turn(_REQUEST)) == [
        *_EXPECTED_EVENTS[:-1],
        TurnComplete("tool_use", TokenUsage()),
    ]


def test_openai_reads_a_tool_call_sent_whole_without_an_id(
    server: tuple[str, dict[str, Any]],
) -> None:
    # The call arrives in one chunk with its finish reason; lacking an id it gets a stable
    # one from its index, so the tool result can still be matched back to it.
    base_url, _ = server

    assert list(_variant(base_url, "whole-call").stream_turn(_REQUEST)) == [
        TextDelta("Let me "),
        TextDelta("check."),
        ToolUse("call_0", "search_objects", {"query": "store"}),
        TurnComplete("tool_use", TokenUsage()),
    ]


def test_openai_reports_an_answer_cut_off_at_the_output_cap(
    server: tuple[str, dict[str, Any]],
) -> None:
    base_url, _ = server

    assert list(_variant(base_url, "truncated").stream_turn(_REQUEST)) == [
        TextDelta("The store table "),
        TurnComplete("max_tokens", TokenUsage(input_tokens=42, output_tokens=8)),
    ]
