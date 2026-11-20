"""Tests for the AI provider adapters' translation, without a network.

The adapters' request/response translation is pure and factored out, so it is exercised here
with hand-built turn requests and fake SDK stream objects — no provider is contacted. The
live behaviour of a real endpoint is proven separately by the gated live navigator test.
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
from shirube.adapters.ai.factory import build_provider, check_provider, list_provider_models
from shirube.adapters.ai.openai_provider import (
    OpenAiCompatibleProvider,
    is_openai_platform,
    parse_openai_stream,
    to_openai_messages,
    to_openai_tools,
)
from shirube.adapters.ai.openai_responses_provider import (
    OpenAiResponsesProvider,
    parse_responses_stream,
    to_responses_input,
    to_responses_tools,
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
from shirube.domain.errors import (
    InvalidProviderConfigError,
    ProviderCheckError,
    ProviderRequestError,
)

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


# --- model listing (the settings model picker) ---------------------------------------


def test_openai_list_models_returns_the_reported_ids() -> None:
    provider = OpenAiCompatibleProvider("m", "http://localhost:11434/v1")
    provider._client = _models(  # type: ignore[assignment]
        lambda: [SimpleNamespace(id="llama3.1"), SimpleNamespace(id="qwen2.5")]
    )
    assert provider.list_models() == ["llama3.1", "qwen2.5"]


def test_anthropic_list_models_returns_the_reported_ids() -> None:
    provider = AnthropicProvider("claude-opus-4-8", api_key="sk-ant-test")
    provider._client = _models(  # type: ignore[assignment]
        lambda: [SimpleNamespace(id="claude-opus-4-8"), SimpleNamespace(id="claude-sonnet-4-6")]
    )
    assert provider.list_models() == ["claude-opus-4-8", "claude-sonnet-4-6"]


def test_openai_list_models_translates_a_connection_failure() -> None:
    provider = OpenAiCompatibleProvider("m", "http://localhost:9/v1")

    def _fail() -> None:
        raise OpenAIConnectionError(request=httpx.Request("GET", "http://localhost:9/v1"))

    provider._client = _models(_fail)  # type: ignore[assignment]
    with pytest.raises(ProviderCheckError, match="Could not reach"):
        provider.list_models()


def test_list_provider_models_anthropic_needs_a_key() -> None:
    config = AiProviderConfig(AiProviderKind.ANTHROPIC, "claude-opus-4-8", None)
    with pytest.raises(ProviderCheckError, match="API key"):
        list_provider_models(config, None)


def test_list_provider_models_openai_compatible_needs_a_base_url() -> None:
    config = AiProviderConfig(AiProviderKind.OPENAI_COMPATIBLE, "m", None)
    with pytest.raises(InvalidProviderConfigError):
        list_provider_models(config, None)


def test_list_provider_models_anthropic_lists_via_its_adapter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The model is irrelevant to listing, so the factory passes it through untouched; stub the
    # adapter's network call to prove the routing and the returned ids.
    monkeypatch.setattr(AnthropicProvider, "list_models", lambda self: ["claude-opus-4-8"])
    config = AiProviderConfig(AiProviderKind.ANTHROPIC, "", None)
    assert list_provider_models(config, "sk-ant-test") == ["claude-opus-4-8"]


def test_list_provider_models_openai_compatible_lists_via_its_adapter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(OpenAiCompatibleProvider, "list_models", lambda self: ["llama3.1"])
    config = AiProviderConfig(AiProviderKind.OPENAI_COMPATIBLE, "", "http://localhost:11434/v1")
    assert list_provider_models(config, None) == ["llama3.1"]


# --- reasoning models: output cap and truncation ---------------------------------------


def test_openai_stream_reports_a_length_cut_off_as_max_tokens() -> None:
    # A reasoning model can spend the whole cap on hidden reasoning and stop with no text.
    events = list(parse_openai_stream([_delta_chunk(finish_reason="length")]))
    assert events == [TurnComplete("max_tokens", TokenUsage())]


def test_anthropic_reports_a_max_tokens_stop() -> None:
    final = SimpleNamespace(content=[], stop_reason="max_tokens", usage=None)
    assert list(events_from_final_message(final)) == [TurnComplete("max_tokens", TokenUsage())]


@pytest.mark.parametrize(
    ("base_url", "expected"),
    [
        ("https://api.openai.com/v1", True),
        ("https://API.OpenAI.com/v1/", True),
        ("http://localhost:11434/v1", False),
        ("https://api.openai.com.example.net/v1", False),
        ("https://gateway.example.com/api.openai.com/v1", False),
        (None, False),
    ],
)
def test_is_openai_platform_matches_only_the_platform_host(
    base_url: str | None, expected: bool
) -> None:
    assert is_openai_platform(base_url) is expected


def _captured_create(provider: OpenAiCompatibleProvider) -> dict[str, object]:
    """Swap the SDK call for a recorder and run one turn, returning the request kwargs."""
    sent: dict[str, object] = {}

    def create(**kwargs: object) -> list[object]:
        sent.update(kwargs)
        return []

    provider._client = SimpleNamespace(  # type: ignore[assignment]
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    list(provider.stream_turn(_REQUEST))
    return sent


def test_openai_platform_sends_the_cap_as_max_completion_tokens() -> None:
    provider = OpenAiCompatibleProvider(
        "gpt-5", base_url="https://api.openai.com/v1", api_key="k", max_tokens=512
    )
    sent = _captured_create(provider)
    assert sent["max_completion_tokens"] == 512 and "max_tokens" not in sent


def test_other_endpoints_send_the_cap_as_max_tokens() -> None:
    provider = OpenAiCompatibleProvider(
        "llama3.1", base_url="http://localhost:11434/v1", max_tokens=512
    )
    sent = _captured_create(provider)
    assert sent["max_tokens"] == 512 and "max_completion_tokens" not in sent


def _captured_responses_create(provider: OpenAiResponsesProvider) -> dict[str, object]:
    """Swap the Responses SDK call for a recorder and run one turn, returning its kwargs."""
    sent: dict[str, object] = {}

    def create(**kwargs: object) -> list[object]:
        sent.update(kwargs)
        return []

    provider._client = SimpleNamespace(  # type: ignore[assignment]
        responses=SimpleNamespace(create=create)
    )
    list(provider.stream_turn(_REQUEST))
    return sent


def test_factory_sends_the_openai_platform_through_the_responses_api_uncapped() -> None:
    # Its reasoning models only take tools there; and a reasoning model spends hidden
    # reasoning from the cap, so none is sent.
    config = AiProviderConfig(
        AiProviderKind.OPENAI_COMPATIBLE, "gpt-5", "https://api.openai.com/v1", 128000
    )
    provider = build_provider(config, "k")
    assert isinstance(provider, OpenAiResponsesProvider)
    sent = _captured_responses_create(provider)
    assert "max_output_tokens" not in sent
    assert sent["store"] is False
    assert sent["include"] == ["reasoning.encrypted_content"]
    assert sent["instructions"] == "You are the navigator."


def test_factory_keeps_other_endpoints_on_chat_completions() -> None:
    config = AiProviderConfig(
        AiProviderKind.OPENAI_COMPATIBLE, "gpt-5", "https://gateway.example/v1", 128000
    )
    assert isinstance(build_provider(config, "k"), OpenAiCompatibleProvider)


def test_responses_provider_ignores_an_environment_key(monkeypatch: pytest.MonkeyPatch) -> None:
    # A keyless config must not quietly borrow OPENAI_API_KEY, nor fail while being built.
    monkeypatch.setenv("OPENAI_API_KEY", "from-the-environment")
    provider = OpenAiResponsesProvider("gpt-5", base_url="https://api.openai.com/v1", api_key=None)
    assert provider._client.api_key == "missing"


def test_responses_provider_sends_a_set_cap_as_max_output_tokens() -> None:
    provider = OpenAiResponsesProvider(
        "gpt-5", base_url="https://api.openai.com/v1", api_key="k", max_tokens=512
    )
    assert _captured_responses_create(provider)["max_output_tokens"] == 512


# --- OpenAI Responses API ------------------------------------------------------------


def test_to_responses_input_maps_each_role_and_replays_reasoning_first() -> None:
    reasoning = {"type": "reasoning", "id": "rs_1", "encrypted_content": "opaque"}
    request = TurnRequest(
        system="sys",
        messages=(
            TurnMessage(ChatRole.USER, "Where does store live?"),
            TurnMessage(
                ChatRole.ASSISTANT,
                "Let me look.",
                tool_calls=(ToolCall("c1", "search_objects", {"query": "store"}),),
                provider_state=(reasoning,),
            ),
            TurnMessage(ChatRole.TOOL, '{"results": []}', tool_call_id="c1"),
        ),
        tools=(),
    )

    assert to_responses_input(request) == [
        {"role": "user", "content": "Where does store live?"},
        reasoning,
        {"role": "assistant", "content": "Let me look."},
        {
            "type": "function_call",
            "call_id": "c1",
            "name": "search_objects",
            "arguments": '{"query": "store"}',
        },
        {"type": "function_call_output", "call_id": "c1", "output": '{"results": []}'},
    ]


def test_to_responses_input_omits_an_empty_assistant_text() -> None:
    request = TurnRequest(
        system="sys",
        messages=(
            TurnMessage(ChatRole.ASSISTANT, "", tool_calls=(ToolCall("c1", "list_schemas", {}),)),
        ),
        tools=(),
    )
    assert [item.get("type", item.get("role")) for item in to_responses_input(request)] == [
        "function_call"
    ]


def test_to_responses_tools_is_flat_and_not_strict() -> None:
    assert to_responses_tools([_TOOL]) == [
        {
            "type": "function",
            "name": "search_objects",
            "description": "Find objects.",
            "parameters": {"type": "object", "properties": {}},
            "strict": False,
        }
    ]


class _Item(SimpleNamespace):
    def model_dump(self, exclude_none: bool = False) -> dict[str, object]:
        return {k: v for k, v in vars(self).items() if not (exclude_none and v is None)}


def _event(kind: str, **fields: object) -> SimpleNamespace:
    return SimpleNamespace(type=kind, **fields)


def _response(**fields: object) -> SimpleNamespace:
    return SimpleNamespace(usage=SimpleNamespace(input_tokens=42, output_tokens=17), **fields)


def test_parse_responses_stream_relays_text_tool_calls_and_reasoning() -> None:
    reasoning = _Item(type="reasoning", id="rs_1", encrypted_content="opaque", summary=[])
    call = _Item(
        type="function_call", call_id="call_1", name="search_objects", arguments='{"query": "s"}'
    )
    events = [
        _event("response.created"),
        _event("response.output_item.done", item=reasoning),
        _event("response.output_text.delta", delta="Let me "),
        _event("response.output_text.delta", delta="check."),
        _event("response.function_call_arguments.delta", delta='{"query'),
        _event("response.output_item.done", item=call),
        _event("response.completed", response=_response()),
    ]

    assert list(parse_responses_stream(events)) == [
        TextDelta("Let me "),
        TextDelta("check."),
        ToolUse("call_1", "search_objects", {"query": "s"}),
        TurnComplete(
            "tool_use",
            TokenUsage(input_tokens=42, output_tokens=17),
            provider_state=(
                {"type": "reasoning", "id": "rs_1", "encrypted_content": "opaque", "summary": []},
            ),
        ),
    ]


def test_parse_responses_stream_ends_a_plain_answer() -> None:
    events = [
        _event("response.output_text.delta", delta="Done."),
        _event("response.completed", response=_response()),
    ]
    assert list(parse_responses_stream(events))[-1] == TurnComplete(
        "end_turn", TokenUsage(input_tokens=42, output_tokens=17)
    )


def test_parse_responses_stream_reports_the_output_cap() -> None:
    call = _Item(type="function_call", call_id="c", name="get_object", arguments='{"ref')
    events = [
        _event("response.output_item.done", item=call),
        _event(
            "response.incomplete",
            response=_response(incomplete_details=SimpleNamespace(reason="max_output_tokens")),
        ),
    ]
    # A cut-off call still surfaces, but the stop reason keeps the loop from running it.
    *_, complete = parse_responses_stream(events)
    assert isinstance(complete, TurnComplete) and complete.stop_reason == "max_tokens"


def test_parse_responses_stream_tolerates_unparseable_arguments() -> None:
    call = _Item(type="function_call", call_id="c", name="list_schemas", arguments="[1, 2]")
    events = [
        _event("response.output_item.done", item=call),
        _event("response.completed", response=_response()),
    ]
    assert ToolUse("c", "list_schemas", {}) in list(parse_responses_stream(events))


@pytest.mark.parametrize(
    "event",
    [
        _event("response.failed", response=SimpleNamespace(error=SimpleNamespace(message="boom"))),
        _event("error", message="boom"),
    ],
)
def test_parse_responses_stream_raises_a_mid_stream_failure(event: SimpleNamespace) -> None:
    with pytest.raises(ProviderRequestError) as caught:
        list(parse_responses_stream([event]))
    assert caught.value.detail == "The AI provider returned an error: boom"


def test_factory_caps_a_local_runner_to_its_output_reserve() -> None:
    config = AiProviderConfig(
        AiProviderKind.OPENAI_COMPATIBLE, "llama3.1", "http://localhost:11434/v1", 4096
    )
    sent = _captured_create(build_provider(config, None))  # type: ignore[arg-type]
    assert sent["max_tokens"] == 1024
