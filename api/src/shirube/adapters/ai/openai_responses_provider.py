"""OpenAI platform adapter over the Responses API (Milestone 2 — AI navigator).

The OpenAI platform's newest reasoning models refuse function tools alongside reasoning on
the chat-completions API, and the navigator always offers tools, so the platform itself is
reached through ``/v1/responses`` instead. Every other OpenAI-compatible endpoint (Ollama,
gateways) keeps the chat-completions adapter, which is the shape they all speak.

The Responses API also lets a reasoning model keep its train of thought across the tool
calls of one answer: its reasoning comes back encrypted (nothing is stored on OpenAI's side,
``store=False``) and is sent back with the next request. That reasoning travels as the
turn's opaque ``provider_state``.

As with the other adapters, the translation is factored into pure functions so it can be
unit-tested without a network.
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
from shirube.domain.errors import ProviderRequestError, provider_error_reason

# Ask for the reasoning in a form that can be sent back without OpenAI keeping the
# conversation; a model that does not reason simply returns none.
_INCLUDE = ["reasoning.encrypted_content"]
_MISSING_KEY = "missing"  # nosec B105  (a placeholder, not a real credential)


def to_responses_input(request: TurnRequest) -> list[dict[str, Any]]:
    """Translate a neutral turn into the Responses API ``input`` items.

    An assistant message becomes its replayed reasoning (``provider_state``), then its text,
    then one ``function_call`` item per tool call — the order the model produced them in. A
    tool result becomes a ``function_call_output`` keyed by the call it answers.
    """
    items: list[dict[str, Any]] = []
    for message in request.messages:
        if message.role is ChatRole.USER:
            items.append({"role": "user", "content": message.content})
        elif message.role is ChatRole.ASSISTANT:
            items.extend(message.provider_state)
            if message.content:
                items.append({"role": "assistant", "content": message.content})
            items.extend(
                {
                    "type": "function_call",
                    "call_id": call.id,
                    "name": call.name,
                    "arguments": json.dumps(call.arguments),
                }
                for call in message.tool_calls
            )
        elif message.role is ChatRole.TOOL:
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": message.tool_call_id,
                    "output": message.content,
                }
            )
    return items


def to_responses_tools(tools: Iterable[ToolDefinition]) -> list[dict[str, Any]]:
    """Translate the neutral tool definitions into Responses API function tools.

    ``strict`` is off: strict mode demands every property be required and no others allowed,
    which the navigator's optional arguments do not meet.
    """
    return [
        {
            "type": "function",
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
            "strict": False,
        }
        for tool in tools
    ]


def _parse_arguments(raw: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _usage(response: Any) -> TokenUsage:
    usage = getattr(response, "usage", None)
    if usage is None:
        return TokenUsage()
    return TokenUsage(input_tokens=usage.input_tokens, output_tokens=usage.output_tokens)


def parse_responses_stream(events: Iterable[Any]) -> Iterator[ProviderEvent]:
    """Turn a streamed Responses API answer into neutral provider events.

    Text is relayed as it arrives. Tool calls and reasoning are taken from each finished
    output item; the tool calls are emitted once the stream ends, ahead of the final
    :class:`TurnComplete`, which carries the reasoning to send back.

    Raises:
        ProviderRequestError: if the response fails part-way, carrying the provider's reason.
    """
    calls: list[ToolUse] = []
    reasoning: list[dict[str, Any]] = []
    stop_reason = "end_turn"
    usage = TokenUsage()

    for event in events:
        kind = getattr(event, "type", None)
        if kind == "response.output_text.delta":
            if event.delta:
                yield TextDelta(event.delta)
        elif kind == "response.output_item.done":
            item = event.item
            if item.type == "function_call":
                calls.append(ToolUse(item.call_id, item.name, _parse_arguments(item.arguments)))
            elif item.type == "reasoning":
                reasoning.append(item.model_dump(exclude_none=True))
        elif kind == "response.completed":
            usage = _usage(event.response)
        elif kind == "response.incomplete":
            usage = _usage(event.response)
            details = getattr(event.response, "incomplete_details", None)
            if getattr(details, "reason", None) == "max_output_tokens":
                stop_reason = "max_tokens"
        elif kind == "response.failed":
            error = getattr(event.response, "error", None)
            reason = getattr(error, "message", None) or "the response failed"
            raise ProviderRequestError(f"The AI provider returned an error: {reason}")
        elif kind == "error":
            raise ProviderRequestError(f"The AI provider returned an error: {event.message}")

    if calls and stop_reason != "max_tokens":
        stop_reason = "tool_use"
    yield from calls
    yield TurnComplete(stop_reason, usage, provider_state=tuple(reasoning))


class OpenAiResponsesProvider:
    """Streams a chat turn from the OpenAI platform via the Responses API."""

    def __init__(
        self,
        model: str,
        base_url: str,
        api_key: str | None,
        max_tokens: int | None = None,
    ) -> None:
        self._model = model
        self._max_tokens = max_tokens
        # Never let the SDK fall back to an ``OPENAI_API_KEY`` from the environment: a missing
        # key is sent as a placeholder, which the platform rejects as an authentication error.
        self._client = OpenAI(base_url=base_url, api_key=api_key or _MISSING_KEY)

    def stream_turn(self, request: TurnRequest) -> Iterator[ProviderEvent]:
        """Stream one turn via the Responses API, yielding neutral events.

        Raises:
            ProviderRequestError: if the API rejects or fails the request, carrying its own
                explanation.
        """
        try:
            yield from parse_responses_stream(self._create(request))
        except (APIConnectionError, AuthenticationError):
            # Not the provider's verdict on this request: leave these to the generic message.
            raise
        except APIError as exc:
            raise ProviderRequestError(
                f"The AI provider returned an error: {provider_error_reason(exc)}"
            ) from exc

    def _create(self, request: TurnRequest) -> Any:
        # Plain dicts are valid at the wire level but not for the SDK's typed overloads, so
        # the arguments are gathered loosely typed.
        params: dict[str, Any] = {
            "model": self._model,
            "instructions": request.system,
            "input": to_responses_input(request),
            "tools": to_responses_tools(request.tools),
            "stream": True,
            # Keep nothing on OpenAI's side; the reasoning is returned encrypted instead.
            "store": False,
            "include": _INCLUDE,
        }
        if self._max_tokens is not None:
            params["max_output_tokens"] = self._max_tokens
        return self._client.responses.create(**params)
