"""Anthropic-native provider adapter (Milestone 2 — AI navigator).

Talks to the Claude API directly via the ``anthropic`` SDK, so Claude — the recommended
default — gets first-class tool use and streaming rather than a lowest-common-denominator
shim. The translation to and from the Anthropic wire shapes is factored into pure functions
for testing without a network.
"""

from collections.abc import Iterable, Iterator
from typing import Any

from anthropic import Anthropic, APIConnectionError, APIError, AuthenticationError

from shirube.adapters.ai.recommended import ANTHROPIC_MODEL
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
from shirube.domain.errors import (
    ProviderCheckError,
    ProviderRequestError,
    provider_error_reason,
)

# The recommended default when the configured model is blank (see ``recommended.py``), and
# the per-turn output cap. Current Claude models think before answering, and that thinking
# counts against the cap even though its text is not returned, so the cap leaves room for it
# as well as the reply. Only what is generated is billed, so the headroom itself costs nothing.
DEFAULT_MODEL = ANTHROPIC_MODEL
MAX_TOKENS = 16_000

# Content blocks that carry the model's reasoning. A turn that has them is sent back exactly
# as produced, so the model keeps its train of thought across the tool calls.
_THINKING_BLOCKS = ("thinking", "redacted_thinking")


def to_anthropic_messages(request: TurnRequest) -> list[dict[str, Any]]:
    """Translate a neutral turn into the Anthropic ``messages`` list.

    An assistant turn becomes text and ``tool_use`` blocks — or, when it carries its own
    content blocks in ``provider_state`` (a turn that thought; see
    :func:`events_from_final_message`), exactly those blocks, unchanged and in order. A tool
    result becomes a user message carrying a ``tool_result`` block keyed by the call it
    answers.
    """
    messages: list[dict[str, Any]] = []
    for message in request.messages:
        if message.role is ChatRole.USER:
            messages.append({"role": "user", "content": message.content})
        elif message.role is ChatRole.ASSISTANT and message.provider_state:
            messages.append({"role": "assistant", "content": list(message.provider_state)})
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


def _replayable_block(block: Any) -> dict[str, Any] | None:
    """A content block as it must be sent back: only the fields the API reads from it."""
    if block.type == "thinking":
        return {"type": "thinking", "thinking": block.thinking, "signature": block.signature}
    if block.type == "redacted_thinking":
        return {"type": "redacted_thinking", "data": block.data}
    if block.type == "text":
        return {"type": "text", "text": block.text}
    if block.type == "tool_use":
        return {"type": "tool_use", "id": block.id, "name": block.name, "input": block.input}
    return None


def _replay_state(final: Any) -> tuple[dict[str, Any], ...]:
    """The turn's content to send back verbatim, when it holds reasoning; else nothing.

    A thinking block is valid only alongside the exact turn that produced it, so a turn that
    thought is kept whole — its blocks, in order — rather than rebuilt from the neutral text
    and tool calls. A turn without reasoning needs no such care.
    """
    if not any(block.type in _THINKING_BLOCKS for block in final.content):
        return ()
    blocks = (_replayable_block(block) for block in final.content)
    return tuple(block for block in blocks if block is not None)


# Anthropic stop reasons the loop acts on; anything else (``end_turn``, ``stop_sequence``,
# ``pause_turn``) ends the turn normally.
_STOP_REASONS = ("tool_use", "max_tokens", "refusal")


def events_from_final_message(final: Any) -> Iterator[ProviderEvent]:
    """Emit the tool calls and completion from a finished Anthropic message.

    Text has already been streamed via the SDK's ``text_stream``; this reads the final
    message for its ``tool_use`` blocks, its stop reason and usage, and — when the model
    thought — the content to send back with it on the next turn.
    """
    for block in final.content:
        if block.type == "tool_use":
            yield ToolUse(id=block.id, name=block.name, arguments=dict(block.input))
    stop_reason = final.stop_reason if final.stop_reason in _STOP_REASONS else "end_turn"
    usage = (
        TokenUsage(input_tokens=final.usage.input_tokens, output_tokens=final.usage.output_tokens)
        if final.usage is not None
        else TokenUsage()
    )
    yield TurnComplete(stop_reason, usage, provider_state=_replay_state(final))


class AnthropicProvider:
    """Streams a chat turn from the Claude API."""

    def __init__(self, model: str, api_key: str | None, base_url: str | None = None) -> None:
        self._model = model or DEFAULT_MODEL
        options: dict[str, Any] = {"api_key": api_key}
        if base_url:
            options["base_url"] = base_url
        self._client = Anthropic(**options)

    def stream_turn(self, request: TurnRequest) -> Iterator[ProviderEvent]:
        """Stream one turn via the Messages API, yielding neutral events.

        Raises:
            ProviderRequestError: if the API rejects or fails the request, carrying its own
                explanation.
        """
        try:
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
        except (APIConnectionError, AuthenticationError):
            # Not the provider's verdict on this request: leave these to the generic message.
            raise
        except APIError as exc:
            raise ProviderRequestError(
                f"The AI provider returned an error: {provider_error_reason(exc)}"
            ) from exc

    def list_models(self) -> list[str]:
        """List the model ids the account can use.

        A cheap, read-only call that costs no tokens, used both to check the configuration
        and to populate the settings form's model picker. Returns the ids in the order the
        API reports them (Claude lists newest first). Raises :class:`ProviderCheckError` with
        an actionable message on failure.
        """
        try:
            return [model.id for model in self._client.models.list()]
        except AuthenticationError as exc:
            raise ProviderCheckError("The provider rejected the API key.") from exc
        except APIConnectionError as exc:
            raise ProviderCheckError(
                "Could not reach the Claude API. Check your network and any base URL."
            ) from exc
        except APIError as exc:
            raise ProviderCheckError(f"The provider returned an error: {exc}") from exc

    def check(self) -> None:
        """Verify the Claude API is reachable and the key is accepted.

        Delegates to :meth:`list_models` — listing the models is the cheap, token-free call
        that both proves reachability and rejects a bad key — so the two share one error
        translation. Raises :class:`ProviderCheckError` on failure.
        """
        self.list_models()
