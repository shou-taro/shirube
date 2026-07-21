"""Tests for the AI provider adapters' translation, without a network.

The adapters' request/response translation is pure and factored out, so it is exercised here
with hand-built turn requests and fake SDK stream objects — no provider is contacted. The
live behaviour of a real endpoint is proven separately by the gated Ollama integration test.
"""

import json
from types import SimpleNamespace

import httpx
import pytest
from anthropic import APIConnectionError as AnthropicConnectionError
from openai import APIConnectionError as OpenAIConnectionError

from shirube.adapters.ai.anthropic_provider import (
    AnthropicProvider,
    events_from_final_message,
    to_anthropic_messages,
    to_anthropic_tools,
)
from shirube.adapters.ai.factory import build_provider, check_provider
from shirube.adapters.ai.openai_provider import (
    OpenAiCompatibleProvider,
    parse_openai_stream,
    to_openai_messages,
    to_openai_tools,
)
from shirube.domain.ai import AiProviderConfig, AiProviderKind
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
from shirube.domain.errors import InvalidProviderConfigError, ProviderCheckError

_TOOL = ToolDefinition("search_objects", "Find objects.", {"type": "object", "properties": {}})

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
    tools=(_TOOL,),
)


# --- OpenAI-compatible ---------------------------------------------------------------


def _delta_chunk(content=None, tool_calls=None, finish_reason=None):  # type: ignore[no-untyped-def]
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                delta=SimpleNamespace(content=content, tool_calls=tool_calls),
                finish_reason=finish_reason,
            )
        ],
        usage=None,
    )


def _usage_chunk(prompt: int, completion: int) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[], usage=SimpleNamespace(prompt_tokens=prompt, completion_tokens=completion)
    )


def _tool_delta(index, id=None, name=None, arguments=None):  # type: ignore[no-untyped-def]
    return SimpleNamespace(
        index=index, id=id, function=SimpleNamespace(name=name, arguments=arguments)
    )


def test_openai_stream_assembles_text_fragmented_tool_call_and_usage() -> None:
    chunks = [
        _delta_chunk(content="Loo"),
        _delta_chunk(content="king…"),
        _delta_chunk(
            tool_calls=[_tool_delta(0, id="call_1", name="search_objects", arguments='{"que')]
        ),
        _delta_chunk(
            tool_calls=[_tool_delta(0, arguments='ry":"store"}')], finish_reason="tool_calls"
        ),
        _usage_chunk(167, 38),
    ]

    events = list(parse_openai_stream(chunks))

    assert TextDelta("Loo") in events and TextDelta("king…") in events
    tool_uses = [e for e in events if isinstance(e, ToolUse)]
    assert tool_uses == [ToolUse("call_1", "search_objects", {"query": "store"})]
    assert events[-1] == TurnComplete("tool_use", TokenUsage(167, 38))


def test_openai_stream_plain_answer_ends_on_stop() -> None:
    events = list(parse_openai_stream([_delta_chunk(content="Hi.", finish_reason="stop")]))
    assert events == [TextDelta("Hi."), TurnComplete("end_turn", TokenUsage())]


def test_openai_messages_translation() -> None:
    messages = to_openai_messages(_REQUEST)
    assert messages[0] == {"role": "system", "content": "You are the navigator."}
    assert messages[1] == {"role": "user", "content": "Where does store live?"}
    assistant = messages[2]
    assert assistant["role"] == "assistant" and assistant["content"] == "Let me look."
    call = assistant["tool_calls"][0]
    assert call["id"] == "c1" and call["function"]["name"] == "search_objects"
    assert json.loads(call["function"]["arguments"]) == {"query": "store"}
    assert messages[3] == {"role": "tool", "tool_call_id": "c1", "content": '{"results": []}'}


def test_openai_tools_translation() -> None:
    assert to_openai_tools([_TOOL]) == [
        {
            "type": "function",
            "function": {
                "name": "search_objects",
                "description": "Find objects.",
                "parameters": {"type": "object", "properties": {}},
            },
        }
    ]


# --- Anthropic-native ----------------------------------------------------------------


def test_anthropic_final_message_yields_tool_use_then_complete() -> None:
    final = SimpleNamespace(
        content=[
            SimpleNamespace(type="text", text="Looking."),
            SimpleNamespace(
                type="tool_use", id="tu1", name="get_object", input={"ref": "public.store"}
            ),
        ],
        stop_reason="tool_use",
        usage=SimpleNamespace(input_tokens=10, output_tokens=5),
    )

    events = list(events_from_final_message(final))

    assert events == [
        ToolUse("tu1", "get_object", {"ref": "public.store"}),
        TurnComplete("tool_use", TokenUsage(10, 5)),
    ]


def test_anthropic_messages_translation() -> None:
    messages = to_anthropic_messages(_REQUEST)
    assert messages[0] == {"role": "user", "content": "Where does store live?"}
    assistant = messages[1]
    assert assistant["role"] == "assistant"
    assert assistant["content"][0] == {"type": "text", "text": "Let me look."}
    assert assistant["content"][1] == {
        "type": "tool_use",
        "id": "c1",
        "name": "search_objects",
        "input": {"query": "store"},
    }
    assert messages[2] == {
        "role": "user",
        "content": [{"type": "tool_result", "tool_use_id": "c1", "content": '{"results": []}'}],
    }


def test_anthropic_tools_translation() -> None:
    assert to_anthropic_tools([_TOOL]) == [
        {
            "name": "search_objects",
            "description": "Find objects.",
            "input_schema": {"type": "object", "properties": {}},
        }
    ]


# --- factory -------------------------------------------------------------------------


def test_factory_builds_openai_compatible() -> None:
    config = AiProviderConfig(
        AiProviderKind.OPENAI_COMPATIBLE, "gpt-oss:20b", "http://localhost:11434/v1"
    )
    assert isinstance(build_provider(config, None), OpenAiCompatibleProvider)


def test_factory_rejects_openai_compatible_without_base_url() -> None:
    config = AiProviderConfig(AiProviderKind.OPENAI_COMPATIBLE, "m", None)
    with pytest.raises(InvalidProviderConfigError):
        build_provider(config, None)


def test_factory_builds_anthropic() -> None:
    config = AiProviderConfig(AiProviderKind.ANTHROPIC, "claude-opus-4-8", None)
    assert isinstance(build_provider(config, "sk-ant-test"), AnthropicProvider)


# --- connection check ----------------------------------------------------------------


def _models(list_fn: object) -> SimpleNamespace:
    """A stand-in SDK client exposing ``client.models.list``."""
    return SimpleNamespace(models=SimpleNamespace(list=list_fn))


def test_openai_check_passes_when_models_list_succeeds() -> None:
    provider = OpenAiCompatibleProvider("m", "http://localhost:11434/v1")
    provider._client = _models(lambda: [])  # type: ignore[assignment]
    provider.check()  # no raise


def test_openai_check_translates_a_connection_failure() -> None:
    provider = OpenAiCompatibleProvider("m", "http://localhost:9/v1")

    def _fail() -> None:
        raise OpenAIConnectionError(request=httpx.Request("GET", "http://localhost:9/v1"))

    provider._client = _models(_fail)  # type: ignore[assignment]
    with pytest.raises(ProviderCheckError, match="Could not reach"):
        provider.check()


def test_anthropic_check_translates_a_connection_failure() -> None:
    provider = AnthropicProvider("claude-opus-4-8", api_key="sk-ant-test")

    def _fail() -> None:
        raise AnthropicConnectionError(request=httpx.Request("GET", "https://api.anthropic.com"))

    provider._client = _models(_fail)  # type: ignore[assignment]
    with pytest.raises(ProviderCheckError, match="Could not reach"):
        provider.check()


def test_check_provider_anthropic_needs_a_key() -> None:
    config = AiProviderConfig(AiProviderKind.ANTHROPIC, "claude-opus-4-8", None)
    with pytest.raises(ProviderCheckError, match="API key"):
        check_provider(config, None)


def test_check_provider_openai_compatible_needs_a_base_url() -> None:
    config = AiProviderConfig(AiProviderKind.OPENAI_COMPATIBLE, "m", None)
    with pytest.raises(InvalidProviderConfigError):
        check_provider(config, None)
