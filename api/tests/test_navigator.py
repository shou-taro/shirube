"""Tests for the AI navigator's chat orchestration.

The loop is driven by a scripted fake provider and a hand-built schema, so no real provider
or database is needed. The focus is the loop itself: relaying text, dispatching the model's
tool calls against the schema and feeding the results back, and the guard rails
(unknown tools, not-found objects, a runaway model, an introspection failure) — plus the
metadata-only guarantee at the orchestration boundary.
"""

import json
from collections.abc import Iterator, Sequence

import pytest

from shirube.application.navigator import MAX_TURNS, NavigatorService
from shirube.domain.chat import (
    ChatMessage,
    ChatRole,
    NavigatorDone,
    NavigatorError,
    NavigatorTextDelta,
    NavigatorToolCall,
    ProviderEvent,
    TextDelta,
    TokenUsage,
    ToolUse,
    TurnComplete,
    TurnRequest,
)
from shirube.domain.errors import ConnectionFailedError
from shirube.domain.schema import (
    Column,
    ObjectKind,
    Relationship,
    SchemaGraph,
    SchemaObject,
)

# A small shop schema: staff → store → address.
_GRAPH = SchemaGraph(
    objects=(
        SchemaObject(
            "public",
            "address",
            ObjectKind.TABLE,
            columns=(Column("address_id", "integer", nullable=False, is_primary_key=True),),
            row_estimate=100,
        ),
        SchemaObject(
            "public",
            "staff",
            ObjectKind.TABLE,
            columns=(
                Column("staff_id", "integer", nullable=False, is_primary_key=True),
                Column("store_id", "integer", nullable=False),
            ),
            row_estimate=10,
        ),
        SchemaObject(
            "public",
            "store",
            ObjectKind.TABLE,
            columns=(
                Column("store_id", "integer", nullable=False, is_primary_key=True),
                Column("address_id", "integer", nullable=False),
            ),
            row_estimate=2,
        ),
    ),
    relationships=(
        Relationship(
            "staff_store_fkey", "public.staff", ("store_id",), "public.store", ("store_id",)
        ),
        Relationship(
            "store_address_fkey", "public.store", ("address_id",), "public.address", ("address_id",)
        ),
    ),
)


class FakeSchemaService:
    """Returns a canned graph, or raises when asked to fail."""

    def __init__(self, graph: SchemaGraph | None = _GRAPH, error: Exception | None = None) -> None:
        self._graph = graph
        self._error = error

    def introspect_profile(self, profile_id: str) -> SchemaGraph:
        if self._error is not None:
            raise self._error
        assert self._graph is not None
        return self._graph


class FakeProvider:
    """Yields a scripted list of events per turn, and records each request it received."""

    def __init__(self, turns: Sequence[Sequence[ProviderEvent]]) -> None:
        self._turns = iter(turns)
        self.requests: list[TurnRequest] = []

    def stream_turn(self, request: TurnRequest) -> Iterator[ProviderEvent]:
        self.requests.append(request)
        return iter(next(self._turns))


def _navigator(provider: FakeProvider, schema: FakeSchemaService | None = None) -> NavigatorService:
    return NavigatorService(schema or FakeSchemaService(), provider)  # type: ignore[arg-type]


def _ask(navigator: NavigatorService, question: str = "Where does store live?") -> list[object]:
    return list(navigator.ask("p1", [ChatMessage(ChatRole.USER, question)]))


def _tool_result(request: TurnRequest, tool_call_id: str) -> dict[str, object]:
    """The parsed tool result fed back in a later turn, by its call id."""
    for message in request.messages:
        if message.role is ChatRole.TOOL and message.tool_call_id == tool_call_id:
            return json.loads(message.content)
    raise AssertionError(f"no tool result for {tool_call_id}")


# --- the loop ------------------------------------------------------------------------


def test_dispatches_a_tool_then_relays_the_answer() -> None:
    provider = FakeProvider(
        [
            [ToolUse("t1", "search_objects", {"query": "store"}), TurnComplete("tool_use")],
            [TextDelta("The "), TextDelta("store table."), TurnComplete("end_turn")],
        ]
    )
    events = _ask(_navigator(provider))

    # The tool call is surfaced, the text streams, and it ends done.
    assert NavigatorToolCall("search_objects") in events
    assert NavigatorTextDelta("The ") in events
    assert NavigatorTextDelta("store table.") in events
    assert isinstance(events[-1], NavigatorDone)

    # The search result was fed back into the second turn, and found the store table.
    result = _tool_result(provider.requests[1], "t1")
    ids = [hit["id"] for hit in result["results"]]  # type: ignore[index]
    assert "public.store" in ids


def test_handles_multiple_tool_calls_in_one_turn() -> None:
    provider = FakeProvider(
        [
            [
                ToolUse("a", "search_objects", {"query": "staff"}),
                ToolUse("b", "get_object", {"ref": "public.store"}),
                TurnComplete("tool_use"),
            ],
            [TextDelta("Done."), TurnComplete("end_turn")],
        ]
    )
    events = _ask(_navigator(provider))

    assert [e for e in events if isinstance(e, NavigatorToolCall)] == [
        NavigatorToolCall("search_objects"),
        NavigatorToolCall("get_object"),
    ]
    # Both results were fed back, keyed to their own call ids.
    assert "results" in _tool_result(provider.requests[1], "a")
    assert _tool_result(provider.requests[1], "b")["id"] == "public.store"


def test_get_object_not_found_is_reported_to_the_model() -> None:
    provider = FakeProvider(
        [
            [ToolUse("t1", "get_object", {"ref": "public.nope"}), TurnComplete("tool_use")],
            [TextDelta("No such table."), TurnComplete("end_turn")],
        ]
    )
    _ask(_navigator(provider))

    assert _tool_result(provider.requests[1], "t1") == {"found": False, "ref": "public.nope"}


def test_unknown_tool_is_reported_not_crashed() -> None:
    provider = FakeProvider(
        [
            [ToolUse("t1", "frobnicate", {}), TurnComplete("tool_use")],
            [TextDelta("Sorry."), TurnComplete("end_turn")],
        ]
    )
    events = _ask(_navigator(provider))

    assert "Unknown tool" in str(_tool_result(provider.requests[1], "t1")["error"])
    assert isinstance(events[-1], NavigatorDone)  # the loop kept going


def test_bad_arguments_are_reported_not_crashed() -> None:
    provider = FakeProvider(
        [
            [ToolUse("t1", "search_objects", {}), TurnComplete("tool_use")],  # missing 'query'
            [TextDelta("ok"), TurnComplete("end_turn")],
        ]
    )
    _ask(_navigator(provider))

    assert "error" in _tool_result(provider.requests[1], "t1")


class LoopingProvider:
    """Never stops asking for tools — to exercise the max-turns guard."""

    def __init__(self) -> None:
        self.calls = 0

    def stream_turn(self, request: TurnRequest) -> Iterator[ProviderEvent]:
        self.calls += 1
        return iter([ToolUse(f"t{self.calls}", "list_schemas", {}), TurnComplete("tool_use")])


def test_stops_after_max_turns() -> None:
    provider = LoopingProvider()
    navigator = NavigatorService(FakeSchemaService(), provider)  # type: ignore[arg-type]

    events = list(navigator.ask("p1", [ChatMessage(ChatRole.USER, "loop forever")]))

    assert isinstance(events[-1], NavigatorError)
    assert provider.calls == MAX_TURNS


def test_introspection_failure_yields_a_navigator_error() -> None:
    provider = FakeProvider([])  # never reached
    schema = FakeSchemaService(error=ConnectionFailedError("Could not connect to the database"))

    events = _ask(_navigator(provider, schema))

    assert events == [NavigatorError("Could not connect to the database")]
    assert provider.requests == []


def test_token_usage_is_accumulated_across_turns() -> None:
    provider = FakeProvider(
        [
            [
                ToolUse("t1", "list_schemas", {}),
                TurnComplete("tool_use", TokenUsage(input_tokens=100, output_tokens=20)),
            ],
            [
                TextDelta("done"),
                TurnComplete("end_turn", TokenUsage(input_tokens=150, output_tokens=30)),
            ],
        ]
    )
    events = _ask(_navigator(provider))

    done = events[-1]
    assert isinstance(done, NavigatorDone)
    assert done.usage == TokenUsage(input_tokens=250, output_tokens=50)


# --- metadata-only guarantee ---------------------------------------------------------


def test_tool_results_carry_metadata_only() -> None:
    """A dispatched look-up returns names/types/relationships — never a row value field."""
    provider = FakeProvider(
        [
            [ToolUse("t1", "get_object", {"ref": "public.store"}), TurnComplete("tool_use")],
            [TextDelta("ok"), TurnComplete("end_turn")],
        ]
    )
    _ask(_navigator(provider))

    result = _tool_result(provider.requests[1], "t1")
    forbidden = {"value", "values", "data", "rows", "row", "sample", "content"}
    assert set(result) & forbidden == set()
    # It does carry the object's metadata.
    assert result["id"] == "public.store"
    assert [column["name"] for column in result["columns"]] == ["store_id", "address_id"]  # type: ignore[index]


@pytest.mark.parametrize("tool", ["search_objects", "list_schemas"])
def test_list_style_results_are_metadata_only(tool: str) -> None:
    args = {"query": "a"} if tool == "search_objects" else {}
    provider = FakeProvider(
        [
            [ToolUse("t1", tool, args), TurnComplete("tool_use")],
            [TextDelta("ok"), TurnComplete("end_turn")],
        ]
    )
    _ask(_navigator(provider))

    result = _tool_result(provider.requests[1], "t1")
    assert "row" not in json.dumps(result).lower().replace("row_estimate", "")
