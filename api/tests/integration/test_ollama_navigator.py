"""The AI navigator proven against a real local model over the OpenAI-compatible adapter.

This drives the whole loop — the ``OpenAiCompatibleProvider`` talking to a real endpoint,
the model deciding to call the look-up tools, the tools running against an in-memory schema,
and the answer streaming back — which no mock can prove. It runs only when
``SHIRUBE_TEST_OLLAMA_URL`` points at a reachable OpenAI-compatible endpoint (e.g. the base
URL of an Ollama instance, ending in ``/v1``); otherwise it skips.
"""

from __future__ import annotations

import os

import pytest

from shirube.adapters.ai.openai_provider import OpenAiCompatibleProvider
from shirube.application.navigator import NavigatorService
from shirube.domain.chat import (
    ChatMessage,
    ChatRole,
    NavigatorDone,
    NavigatorError,
    NavigatorTextDelta,
    NavigatorToolCall,
)
from shirube.domain.schema import (
    Column,
    ObjectKind,
    Relationship,
    SchemaGraph,
    SchemaObject,
)

_URL = os.environ.get("SHIRUBE_TEST_OLLAMA_URL")
_MODEL = os.environ.get("SHIRUBE_TEST_OLLAMA_MODEL", "gpt-oss:20b")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not _URL, reason="SHIRUBE_TEST_OLLAMA_URL is not set; skipping"),
]

# A small shop schema for the model to explore: staff → store → address.
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


class _FixedSchemaService:
    """Stands in for SchemaService, returning the canned graph without a database."""

    def introspect_profile(self, profile_id: str) -> SchemaGraph:
        return _GRAPH


def test_navigator_answers_a_question_over_a_real_model() -> None:
    provider = OpenAiCompatibleProvider(model=_MODEL, base_url=_URL or "")
    navigator = NavigatorService(_FixedSchemaService(), provider)  # type: ignore[arg-type]

    events = list(
        navigator.ask(
            "p1",
            [ChatMessage(ChatRole.USER, "Which table holds stores, and what does it reference?")],
        )
    )

    errors = [event for event in events if isinstance(event, NavigatorError)]
    assert errors == [], f"navigator errored: {errors}"
    # The model drove the look-up tools…
    assert any(isinstance(event, NavigatorToolCall) for event in events)
    # …and produced a non-empty answer, ending cleanly.
    answer = "".join(event.text for event in events if isinstance(event, NavigatorTextDelta))
    assert answer.strip() != ""
    assert isinstance(events[-1], NavigatorDone)
