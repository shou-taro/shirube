"""Anthropic-native provider adapter (Milestone 2 — AI navigator).

Talks to the Claude API directly via the ``anthropic`` SDK, so Claude — the recommended
default — gets first-class tool use and streaming rather than a lowest-common-denominator
shim. The translation to and from the Anthropic wire shapes is factored into pure functions
for testing without a network.
"""

from collections.abc import Iterable, Iterator
from typing import Any

from anthropic import Anthropic

from shirube.domain.chat import (
    ChatRole,
    ProviderEvent,
    TextDelta,
    TokenUsage,
    ToolDefinition,
    ToolUse,
    TurnComplete,
    TurnRequest,
)

# The recommended default when the configured model is blank, and the per-turn output cap.
DEFAULT_MODEL = "claude-opus-4-8"
MAX_TOKENS = 4096


def to_anthropic_messages(request: TurnRequest) -> list[dict[str, Any]]:
    """Translate a neutral turn into the Anthropic ``messages`` list.

    An assistant turn becomes text and ``tool_use`` blocks; a tool result becomes a user
    message carrying a ``tool_result`` block keyed by the call it answers.
    """
    messages: list[dict[str, Any]] = []
    for message in request.messages:
        if message.role is ChatRole.USER:
            messages.append({"role": "user", "content": message.content})
        elif message.role is ChatRole.ASSISTANT:
            blocks: list[dict[str, Any]] = []
            if message.content:
                blocks.append({"type": "text", "text": message.content})
            blocks.extend(
                {"type": "tool_use", "id": call.id, "name": call.name, "input": call.arguments}
                for call in message.tool_calls
            )
            messages.append({"role": "assistant", "content": blocks})
        elif message.role is ChatRole.TOOL:
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": message.tool_call_id,
                            "content": message.content,
                        }
                    ],
                }
            )
    return messages


def to_anthropic_tools(tools: Iterable[ToolDefinition]) -> list[dict[str, Any]]:
    """Translate the neutral tool definitions into Anthropic ``tools`` entries."""
    return [
        {"name": tool.name, "description": tool.description, "input_schema": tool.parameters}
        for tool in tools
    ]


def events_from_final_message(final: Any) -> Iterator[ProviderEvent]:
    """Emit the tool calls and completion from a finished Anthropic message.

    Text has already been streamed via the SDK's ``text_stream``; this reads the final
    message for its ``tool_use`` blocks and its stop reason and usage.
    """
    for block in final.content:
        if block.type == "tool_use":
            yield ToolUse(id=block.id, name=block.name, arguments=dict(block.input))
    stop_reason = "tool_use" if final.stop_reason == "tool_use" else "end_turn"
    usage = (
        TokenUsage(input_tokens=final.usage.input_tokens, output_tokens=final.usage.output_tokens)
        if final.usage is not None
        else TokenUsage()
    )
    yield TurnComplete(stop_reason, usage)


class AnthropicProvider:
    """Streams a chat turn from the Claude API."""

    def __init__(self, model: str, api_key: str | None, base_url: str | None = None) -> None:
        self._model = model or DEFAULT_MODEL
        options: dict[str, Any] = {"api_key": api_key}
        if base_url:
            options["base_url"] = base_url
        self._client = Anthropic(**options)

    def stream_turn(self, request: TurnRequest) -> Iterator[ProviderEvent]:
        """Stream one turn via the Messages API, yielding neutral events."""
        with self._client.messages.stream(
            model=self._model,
            max_tokens=MAX_TOKENS,
            system=request.system,
            tools=to_anthropic_tools(request.tools),  # type: ignore[arg-type]
            messages=to_anthropic_messages(request),  # type: ignore[arg-type]
        ) as stream:
            for text in stream.text_stream:
                yield TextDelta(text)
            yield from events_from_final_message(stream.get_final_message())
