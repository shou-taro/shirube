"""Provider-neutral chat types for the AI navigator (Milestone 2).

These describe a chat turn with tool-calling in terms independent of any one provider, so
the orchestration loop (:class:`~shirube.application.navigator.NavigatorService`) stays
provider-agnostic and testable, and each adapter only has to translate between these types
and its own SDK's shapes.

Three groups:

- **Conversation** — :class:`ChatMessage` is the user-facing history (what the UI shows and
  a later milestone persists).
- **Turn input** — :class:`TurnRequest` (system prompt, the in-flight :class:`TurnMessage`
  list, and the :class:`ToolDefinition`\\ s) is what a provider is asked to continue.
- **Turn output** — a provider streams :class:`ProviderEvent`\\ s (text, tool calls, and a
  final :class:`TurnComplete`); the navigator in turn streams :class:`NavigatorEvent`\\ s to
  its caller.
"""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class ChatRole(StrEnum):
    """Who a message is from, in the neutral turn representation.

    ``TOOL`` carries the result of a look-up the assistant asked for; it is fed back into
    the next turn so the model can read what it requested.
    """

    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


@dataclass(frozen=True, slots=True)
class ChatMessage:
    """One user-facing turn of the conversation — plain text, no tool plumbing.

    This is the history the navigator UI renders and a later milestone persists; the tool
    calls exchanged *within* a turn are an implementation detail held in :class:`TurnMessage`
    and never surface here.

    Attributes:
        role: ``user`` or ``assistant`` (a tool result is never user-facing history).
        content: The message text.
    """

    role: ChatRole
    content: str


@dataclass(frozen=True, slots=True)
class ToolDefinition:
    """A tool offered to the model — name, description and JSON-schema parameters.

    Provider-neutral; each adapter maps it to its SDK's tool format. The parameters are a
    JSON Schema object describing the tool's arguments.

    Attributes:
        name: The tool's name (e.g. ``search_objects``).
        description: What the tool does and when to use it, for the model.
        parameters: JSON Schema (an ``object`` schema) for the tool's arguments.
    """

    name: str
    description: str
    parameters: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ToolCall:
    """A single tool invocation the model asked for.

    Attributes:
        id: The provider's identifier for this call, echoed back on the matching result so
            the model can pair them.
        name: The tool being called.
        arguments: The parsed arguments (already decoded from the provider's JSON).
    """

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True, slots=True)
class TurnMessage:
    """One neutral message in the in-flight turn list the loop maintains.

    Covers all three shapes the loop needs: a user prompt (``role=USER``, ``content``), an
    assistant reply that may request tools (``role=ASSISTANT``, ``content`` and/or
    ``tool_calls``), and a tool result fed back (``role=TOOL``, ``content`` = the serialised
    result, ``tool_call_id`` = the call it answers). Adapters translate this to Anthropic's
    ``tool_use``/``tool_result`` blocks or the OpenAI ``tool_calls``/``role: "tool"`` shape.

    Attributes:
        role: Who the message is from.
        content: The text, or a tool result's serialised content.
        tool_calls: The tool calls an assistant message requested (empty otherwise).
        tool_call_id: For a ``TOOL`` message, the id of the call it answers.
    """

    role: ChatRole
    content: str = ""
    tool_calls: tuple[ToolCall, ...] = ()
    tool_call_id: str | None = None


@dataclass(frozen=True, slots=True)
class TurnRequest:
    """Everything a provider needs to continue the conversation for one turn.

    Attributes:
        system: The system prompt (the navigator's role and rules).
        messages: The conversation so far as neutral turn messages.
        tools: The tools the model may call this turn.
    """

    system: str
    messages: tuple[TurnMessage, ...]
    tools: tuple[ToolDefinition, ...]


# --- Provider stream events (what ``AiProvider.stream_turn`` yields) ------------------


@dataclass(frozen=True, slots=True)
class TextDelta:
    """A chunk of the assistant's text as it streams in."""

    text: str


@dataclass(frozen=True, slots=True)
class ToolUse:
    """A completed tool call the model made this turn (arguments fully assembled)."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True, slots=True)
class TokenUsage:
    """Token counts the provider reported for a turn, when available."""

    input_tokens: int | None = None
    output_tokens: int | None = None


@dataclass(frozen=True, slots=True)
class TurnComplete:
    """The end of one provider turn.

    Attributes:
        stop_reason: Why the turn ended — ``tool_use`` means the model wants its tool calls
            run and the loop should continue; anything else (e.g. ``end_turn``) ends it.
        usage: Token usage for the turn, if the provider reported it.
    """

    stop_reason: str
    usage: TokenUsage = field(default_factory=TokenUsage)


ProviderEvent = TextDelta | ToolUse | TurnComplete
"""A single event in a provider's streamed turn."""


# --- Navigator stream events (what ``NavigatorService.ask`` yields) -------------------


@dataclass(frozen=True, slots=True)
class NavigatorTextDelta:
    """A chunk of the answer to show the user."""

    text: str


@dataclass(frozen=True, slots=True)
class NavigatorToolCall:
    """The navigator looked something up — surfaced for a "looking things up…" indicator.

    Only the tool name is exposed; arguments and results stay internal (and are
    metadata-only regardless).
    """

    name: str


@dataclass(frozen=True, slots=True)
class NavigatorDone:
    """The navigator finished answering.

    Attributes:
        usage: Total token usage across the turn's model calls, if the provider reported it.
    """

    usage: TokenUsage = field(default_factory=TokenUsage)


@dataclass(frozen=True, slots=True)
class NavigatorError:
    """The navigator could not complete — carries a user-safe message."""

    message: str


NavigatorEvent = NavigatorTextDelta | NavigatorToolCall | NavigatorDone | NavigatorError
"""A single event the navigator streams to its caller."""
