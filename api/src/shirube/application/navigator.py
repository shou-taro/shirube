"""The AI navigator's chat orchestration (Milestone 2 — AI navigator).

Runs the tool-calling loop that turns a user's question into an answer: introspect the
connected schema once, offer the model the four read-only look-up tools, relay its text,
run whichever tools it calls against the in-memory schema, feed the results back, and repeat
until it answers. The loop is provider-agnostic — it drives an :class:`AiProvider` one turn
at a time (see :mod:`shirube.domain.chat`) — so the same orchestration works for every
provider adapter.

The navigator reasons over **metadata only**: the look-up tools never return row data or
column values (see :mod:`shirube.application.lookup`), and this loop adds no path that
would. It proposes tables, columns and relationships; a human clicks through to the data.
"""

import json
from collections.abc import Callable, Iterator, Sequence
from dataclasses import asdict

from shirube.application.lookup import DEFAULT_SEARCH_LIMIT, SchemaLookup
from shirube.application.schema import SchemaService
from shirube.domain.chat import (
    ChatMessage,
    ChatRole,
    NavigatorDone,
    NavigatorError,
    NavigatorEvent,
    NavigatorTextDelta,
    NavigatorToolCall,
    TextDelta,
    TokenUsage,
    ToolCall,
    ToolDefinition,
    ToolUse,
    TurnComplete,
    TurnMessage,
    TurnRequest,
)
from shirube.domain.errors import ShirubeError
from shirube.ports.repositories import AiProvider

# A single turn shouldn't need many look-ups; this cap stops a misbehaving model from
# looping on tool calls forever without ever answering.
MAX_TURNS = 12

SYSTEM_PROMPT = """\
You are the navigator for shirube, a read-only PostgreSQL schema explorer. You help the \
user understand the database they are connected to and find their way around it.

You reason over the schema's structure only — table, view and column names, data types, \
primary keys, comments, foreign-key and view-dependency relationships, and catalogue \
row-count estimates. You never see or return actual row data or column values, and you \
never run SQL. You propose where to look; the user clicks through to the data themselves.

Use the tools to look things up rather than guessing:
- search_objects — find tables, views or columns by name (your usual starting point).
- get_object — one object's columns and its relationships (what it references, and what \
references it).
- find_path — how two objects are connected, as a sequence of hops.
- list_schemas — the schemas in the database and how many objects each holds.

Pull in only what the question needs. When you name a table or column in your answer, use \
its exact name. Be concise and concrete, and when the user should look at a specific table \
to go further, say which one.
"""


def _search_objects(lookup: SchemaLookup, arguments: dict[str, object]) -> dict[str, object]:
    query = arguments.get("query")
    if not isinstance(query, str):
        return {"error": "search_objects needs a string 'query'."}
    limit = arguments.get("limit")
    hits = lookup.search_objects(query, limit if isinstance(limit, int) else DEFAULT_SEARCH_LIMIT)
    return {"results": [asdict(hit) for hit in hits]}


def _get_object(lookup: SchemaLookup, arguments: dict[str, object]) -> dict[str, object]:
    ref = arguments.get("ref")
    if not isinstance(ref, str):
        return {"error": "get_object needs a string 'ref' (a schema.name identifier)."}
    detail = lookup.get_object(ref)
    if detail is None:
        return {"found": False, "ref": ref}
    return asdict(detail)


def _find_path(lookup: SchemaLookup, arguments: dict[str, object]) -> dict[str, object]:
    source, target = arguments.get("source"), arguments.get("target")
    if not isinstance(source, str) or not isinstance(target, str):
        return {"error": "find_path needs string 'source' and 'target' identifiers."}
    result = lookup.find_path(source, target)
    if result is None:
        return {"error": "One or both objects do not exist.", "source": source, "target": target}
    return {"found": result.found, "hops": list(result.hops)}


def _list_schemas(lookup: SchemaLookup, arguments: dict[str, object]) -> dict[str, object]:
    return {"schemas": [asdict(summary) for summary in lookup.list_schemas()]}


# The tool name → handler map. Each handler is pure over the schema graph and returns a
# JSON-serialisable, metadata-only result.
_HANDLERS: dict[str, Callable[[SchemaLookup, dict[str, object]], dict[str, object]]] = {
    "search_objects": _search_objects,
    "get_object": _get_object,
    "find_path": _find_path,
    "list_schemas": _list_schemas,
}

# The tools offered to the model, with JSON-schema parameters. Kept alongside the handlers
# so the two never drift.
TOOL_DEFINITIONS: tuple[ToolDefinition, ...] = (
    ToolDefinition(
        name="search_objects",
        description=(
            "Find tables, views and materialized views by name, or by a column they "
            "contain. Ranked best-first. The usual starting point for a question."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Text to search for."},
                "limit": {"type": "integer", "description": "Maximum results (default 8)."},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="get_object",
        description=(
            "Get one object's detail: its columns (name, type, nullability, primary key, "
            "comment) and its relationships, split into what it references and what "
            "references it."
        ),
        parameters={
            "type": "object",
            "properties": {
                "ref": {"type": "string", "description": "The object's schema.name identifier."},
            },
            "required": ["ref"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="find_path",
        description=(
            "Find how two objects are connected: the shortest sequence of hops between them "
            "over the relationship graph, or none if they are unconnected."
        ),
        parameters={
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "Starting object's schema.name."},
                "target": {"type": "string", "description": "Target object's schema.name."},
            },
            "required": ["source", "target"],
            "additionalProperties": False,
        },
    ),
    ToolDefinition(
        name="list_schemas",
        description="List the schemas in the database and how many objects each contains.",
        parameters={"type": "object", "properties": {}, "additionalProperties": False},
    ),
)


def _dispatch(lookup: SchemaLookup, call: ToolCall) -> str:
    """Run one tool call against the schema and return its result as a JSON string.

    An unknown tool name or bad arguments yield an ``{"error": ...}`` result rather than
    raising, so a confused model gets feedback it can recover from instead of ending the
    turn.
    """
    handler = _HANDLERS.get(call.name)
    result = (
        handler(lookup, call.arguments)
        if handler is not None
        else {"error": f"Unknown tool: {call.name}"}
    )
    return json.dumps(result)


def _add_usage(total: TokenUsage, turn: TokenUsage) -> TokenUsage:
    """Accumulate token usage across turns, treating missing counts as zero."""
    return TokenUsage(
        input_tokens=(total.input_tokens or 0) + (turn.input_tokens or 0),
        output_tokens=(total.output_tokens or 0) + (turn.output_tokens or 0),
    )


class NavigatorService:
    """Answers a question about a connected database by driving the tool-calling loop."""

    def __init__(self, schema: SchemaService, provider: AiProvider) -> None:
        self._schema = schema
        self._provider = provider

    def ask(
        self,
        profile_id: str,
        history: Sequence[ChatMessage],
    ) -> Iterator[NavigatorEvent]:
        """Answer the latest question in ``history``, streaming the reply.

        Introspects the profile's schema once and reuses it for every look-up this turn.
        Yields the assistant's text as it streams, a marker for each look-up, and a final
        done (or error) event.

        Args:
            profile_id: The connection whose schema the question is about.
            history: The conversation so far, ending with the user's question.

        Yields:
            The navigator's events — text, tool-call markers, then done or error.
        """
        try:
            graph = self._schema.introspect_profile(profile_id)
        except ShirubeError as exc:
            yield NavigatorError(exc.detail)
            return

        lookup = SchemaLookup(graph)
        messages: list[TurnMessage] = [
            TurnMessage(role=message.role, content=message.content) for message in history
        ]
        usage = TokenUsage()

        for _ in range(MAX_TURNS):
            text_parts: list[str] = []
            calls: list[ToolCall] = []
            for event in self._provider.stream_turn(
                TurnRequest(system=SYSTEM_PROMPT, messages=tuple(messages), tools=TOOL_DEFINITIONS)
            ):
                if isinstance(event, TextDelta):
                    text_parts.append(event.text)
                    yield NavigatorTextDelta(event.text)
                elif isinstance(event, ToolUse):
                    calls.append(ToolCall(id=event.id, name=event.name, arguments=event.arguments))
                    yield NavigatorToolCall(event.name)
                elif isinstance(event, TurnComplete):
                    usage = _add_usage(usage, event.usage)

            messages.append(
                TurnMessage(
                    role=ChatRole.ASSISTANT,
                    content="".join(text_parts),
                    tool_calls=tuple(calls),
                )
            )
            if not calls:
                yield NavigatorDone(usage)
                return

            for call in calls:
                messages.append(
                    TurnMessage(
                        role=ChatRole.TOOL,
                        content=_dispatch(lookup, call),
                        tool_call_id=call.id,
                    )
                )

        yield NavigatorError("The navigator took too many steps without reaching an answer.")
