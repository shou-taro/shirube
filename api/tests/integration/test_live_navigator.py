"""The AI navigator proven against real providers — hosted APIs and local runners alike.

This drives the whole loop — the provider built by the factory exactly as the app builds it,
the model deciding to call the look-up tools, the tools running against an in-memory schema,
and the answer streaming back — which the contract tests' canned responses cannot prove.

One test runs against every configured *target*: a base URL, a key and a model. Each target
is enabled by its own environment variables and skipped when they are absent, so CI (which
sets none) stays green and spends nothing:

- OpenAI platform — ``SHIRUBE_TEST_OPENAI_API_KEY``; models from ``SHIRUBE_TEST_OPENAI_MODELS``
  (comma-separated).
- Claude API — ``SHIRUBE_TEST_ANTHROPIC_API_KEY``; models from
  ``SHIRUBE_TEST_ANTHROPIC_MODELS``.
- Ollama — ``SHIRUBE_TEST_OLLAMA_URL`` (the base URL ending in ``/v1``); model from
  ``SHIRUBE_TEST_OLLAMA_MODEL``.
- Any other OpenAI-compatible endpoint, such as a gateway —
  ``SHIRUBE_TEST_COMPAT_URL``, ``SHIRUBE_TEST_COMPAT_MODELS`` and optionally
  ``SHIRUBE_TEST_COMPAT_API_KEY``.

Hosted targets are billed (a few cents a run). Keep the keys out of the repository and the
shell history: put them in a file only you can read and ``source`` it for the run (see
CONTRIBUTING.md).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import pytest

from shirube.adapters.ai.factory import build_provider, list_provider_models
from shirube.application.navigator import NavigatorService
from shirube.domain.ai import AiProviderConfig, AiProviderKind
from shirube.domain.chat import (
    ChatMessage,
    ChatRole,
    NavigatorDone,
    NavigatorError,
    NavigatorTextDelta,
    NavigatorToolCall,
)
from shirube.domain.connection import DatabaseKind
from shirube.domain.schema import (
    Column,
    ObjectKind,
    Relationship,
    SchemaGraph,
    SchemaObject,
)

pytestmark = pytest.mark.integration


@dataclass(frozen=True)
class _Target:
    """One provider to run the navigator against: how the app would be configured for it."""

    name: str
    config: AiProviderConfig
    # Kept out of the repr, so a failing run's report never prints the key.
    api_key: str | None = field(repr=False)


def _models(var: str, default: str) -> list[str]:
    return [m.strip() for m in os.environ.get(var, default).split(",") if m.strip()]


def _targets() -> list[_Target | None]:
    """Every configured target; ``None`` stands for a provider left unconfigured."""
    env = os.environ.get
    targets: list[_Target | None] = []

    if key := env("SHIRUBE_TEST_OPENAI_API_KEY"):
        targets += [
            _Target(
                f"openai:{model}",
                AiProviderConfig(
                    AiProviderKind.OPENAI_COMPATIBLE,
                    model,
                    base_url="https://api.openai.com/v1",
                    context_window=128_000,
                ),
                key,
            )
            for model in _models("SHIRUBE_TEST_OPENAI_MODELS", "gpt-5.6-luna,gpt-6-luna,gpt-4o")
        ]
    else:
        targets.append(None)

    if key := env("SHIRUBE_TEST_ANTHROPIC_API_KEY"):
        models = _models("SHIRUBE_TEST_ANTHROPIC_MODELS", "claude-haiku-5-5,claude-opus-4-8")
        targets += [
            _Target(f"anthropic:{model}", AiProviderConfig(AiProviderKind.ANTHROPIC, model), key)
            for model in models
        ]
    else:
        targets.append(None)

    if url := env("SHIRUBE_TEST_OLLAMA_URL"):
        model = env("SHIRUBE_TEST_OLLAMA_MODEL", "gpt-oss:20b")
        # Ollama's own default window, as the settings form seeds it: the factory then caps
        # the answer to fit, which is the path a local runner relies on.
        config = AiProviderConfig(
            AiProviderKind.OPENAI_COMPATIBLE, model, base_url=url, context_window=4096
        )
        targets.append(_Target(f"ollama:{model}", config, None))
    else:
        targets.append(None)

    if url := env("SHIRUBE_TEST_COMPAT_URL"):
        targets += [
            _Target(
                f"compat:{model}",
                AiProviderConfig(AiProviderKind.OPENAI_COMPATIBLE, model, base_url=url),
                env("SHIRUBE_TEST_COMPAT_API_KEY"),
            )
            for model in _models("SHIRUBE_TEST_COMPAT_MODELS", "")
        ]
    else:
        targets.append(None)

    return targets


_TARGETS = _targets()
# Unconfigured providers collapse into one skipped case, so a bare run reports a single skip.
_PARAMS = [pytest.param(t, id=t.name) for t in _TARGETS if t is not None] or [
    pytest.param(None, id="no-provider-configured")
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

    def profile_kind(self, profile_id: str) -> DatabaseKind:
        return DatabaseKind.POSTGRESQL


@pytest.mark.parametrize("target", _PARAMS)
def test_navigator_answers_a_question_over_a_real_model(target: _Target | None) -> None:
    if target is None:
        pytest.skip("no live AI provider is configured (see this module's docstring)")

    # The free, token-less model listing first: a wrong key or an unavailable model shows
    # up here, before any billed request is made.
    available = list_provider_models(target.config, target.api_key)
    if available and target.config.model not in available:
        pytest.fail(f"{target.config.model} is not offered by this endpoint")

    provider = build_provider(target.config, target.api_key)
    navigator = NavigatorService(_FixedSchemaService(), provider)  # type: ignore[arg-type]

    # The schema is unknown to the model, so answering forces a tool round trip — which is
    # also where a provider's replay of the earlier turn (tool calls, thinking) is exercised.
    events = list(
        navigator.ask(
            "p1",
            [ChatMessage(ChatRole.USER, "Which table holds stores, and what does it reference?")],
        )
    )

    errors = [event for event in events if isinstance(event, NavigatorError)]
    assert errors == [], f"navigator errored: {errors}"
    assert any(isinstance(event, NavigatorToolCall) for event in events)
    answer = "".join(event.text for event in events if isinstance(event, NavigatorTextDelta))
    assert "address" in answer.lower(), f"answer missed the reference: {answer!r}"
    assert isinstance(events[-1], NavigatorDone)
