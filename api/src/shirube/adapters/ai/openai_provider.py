"""OpenAI-compatible provider adapter (Milestone 2 — AI navigator).

Talks to any endpoint that speaks the OpenAI chat-completions API — OpenAI itself, a gateway,
or a local runner such as Ollama — via the ``openai`` SDK pointed at the configured base URL.
One adapter reaches them all, which is why Ollama needs none of its own.

The translation to and from the OpenAI wire shapes is factored into pure module functions so
it can be unit-tested without a network; the class just wires them to the SDK's streaming
call.
"""

import json
from collections.abc import Iterable, Iterator
from typing import Any

from openai import APIConnectionError, APIError, AuthenticationError, OpenAI

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
from shirube.domain.errors import ProviderCheckError

# The openai SDK requires a non-empty API key even for a local, keyless endpoint; this
# placeholder is sent when the provider needs no key (e.g. Ollama).
_NO_KEY_PLACEHOLDER = "not-needed"  # nosec B105  (a placeholder, not a real credential)


def to_openai_messages(request: TurnRequest) -> list[dict[str, Any]]:
    """Translate a neutral turn into the OpenAI ``messages`` list."""
    messages: list[dict[str, Any]] = [{"role": "system", "content": request.system}]
    for message in request.messages:
        if message.role is ChatRole.USER:
            messages.append({"role": "user", "content": message.content})
        elif message.role is ChatRole.ASSISTANT:
            assistant: dict[str, Any] = {"role": "assistant", "content": message.content or None}
            if message.tool_calls:
                assistant["tool_calls"] = [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {"name": call.name, "arguments": json.dumps(call.arguments)},
                    }
                    for call in message.tool_calls
                ]
            messages.append(assistant)
        elif message.role is ChatRole.TOOL:
            messages.append(
                {"role": "tool", "tool_call_id": message.tool_call_id, "content": message.content}
            )
    return messages


def to_openai_tools(tools: Iterable[ToolDefinition]) -> list[dict[str, Any]]:
    """Translate the neutral tool definitions into OpenAI ``tools`` entries."""
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }
        for tool in tools
    ]


def parse_openai_stream(chunks: Iterable[Any]) -> Iterator[ProviderEvent]:
    """Turn an OpenAI streamed completion into neutral provider events.

    Text arrives as deltas (relayed straight through). Tool calls arrive fragmented — an
    ``index`` with the id, name and ``arguments`` string dribbled across chunks — so they are
    accumulated per index and emitted as one :class:`ToolUse` each once the stream ends, after
    the final :class:`TurnComplete`'s stop reason and usage are known.
    """
    fragments: dict[int, dict[str, Any]] = {}
    stop_reason = "end_turn"
    usage = TokenUsage()

    for chunk in chunks:
        if getattr(chunk, "usage", None):
            usage = TokenUsage(
                input_tokens=chunk.usage.prompt_tokens,
                output_tokens=chunk.usage.completion_tokens,
            )
        for choice in chunk.choices or []:
            delta = choice.delta
            if getattr(delta, "content", None):
                yield TextDelta(delta.content)
            for call in getattr(delta, "tool_calls", None) or []:
                fragment = fragments.setdefault(call.index, {"id": None, "name": None, "args": ""})
                if call.id:
                    fragment["id"] = call.id
                if call.function and call.function.name:
                    fragment["name"] = call.function.name
                if call.function and call.function.arguments:
                    fragment["args"] += call.function.arguments
            if choice.finish_reason:
                stop_reason = "tool_use" if choice.finish_reason == "tool_calls" else "end_turn"

    for index in sorted(fragments):
        fragment = fragments[index]
        try:
            arguments = json.loads(fragment["args"]) if fragment["args"] else {}
        except json.JSONDecodeError:
            arguments = {}
        yield ToolUse(
            id=fragment["id"] or f"call_{index}",
            name=fragment["name"] or "",
            arguments=arguments,
        )
    yield TurnComplete(stop_reason, usage)


class OpenAiCompatibleProvider:
    """Streams a chat turn from an OpenAI-compatible endpoint (OpenAI / Ollama / gateway)."""

    def __init__(
        self,
        model: str,
        base_url: str,
        api_key: str | None = None,
        max_tokens: int | None = None,
    ) -> None:
        self._model = model
        self._max_tokens = max_tokens
        self._client = OpenAI(base_url=base_url, api_key=api_key or _NO_KEY_PLACEHOLDER)

    def stream_turn(self, request: TurnRequest) -> Iterator[ProviderEvent]:
        """Stream one turn via the chat-completions API, yielding neutral events."""
        # Cap the answer's length when a budget was set, so the prompt plus the reply fit the
        # model's context window; a local runner with a small window relies on this.
        extra: dict[str, Any] = {}
        if self._max_tokens is not None:
            extra["max_tokens"] = self._max_tokens
        # The SDK's typed overloads expect its own TypedDict params; we build plain dicts
        # (valid at the wire level) and translate the neutral turn ourselves.
        stream = self._client.chat.completions.create(  # type: ignore[call-overload]
            model=self._model,
            messages=to_openai_messages(request),
            tools=to_openai_tools(request.tools),
            stream=True,
            stream_options={"include_usage": True},
            **extra,
        )
        yield from parse_openai_stream(stream)

    def check(self) -> None:
        """Verify the endpoint is reachable and the key (if any) is accepted.

        Lists the available models — a cheap, read-only call that costs no tokens — so a
        wrong base URL, an unreachable server or a rejected key is caught at configuration
        time. Raises :class:`ProviderCheckError` with an actionable message on failure.
        """
        try:
            self._client.models.list()
        except AuthenticationError as exc:
            raise ProviderCheckError("The provider rejected the API key.") from exc
        except APIConnectionError as exc:
            raise ProviderCheckError(
                "Could not reach the provider. Check the base URL and that the model server "
                "is running."
            ) from exc
        except APIError as exc:
            raise ProviderCheckError(f"The provider returned an error: {exc}") from exc
