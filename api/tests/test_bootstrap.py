"""Tests for the app-state schema bootstrap and its additive migrations.

The local SQLite schema is created (and lightly migrated) on start-up. These tests cover the
one migration that matters: adding the ``context_window`` column to an ``ai_provider_config``
table that predates it, without losing the existing row.
"""

from sqlalchemy import inspect, text

from shirube.adapters.persistence.ai_config_repository import SqlAiConfigRepository
from shirube.adapters.persistence.bootstrap import bootstrap_database
from shirube.adapters.persistence.database import get_engine, get_session_factory
from shirube.domain.ai import AiProviderConfig, AiProviderKind


def _create_pre_migration_table() -> None:
    """Create an ``ai_provider_config`` table as it was before ``context_window`` existed."""
    with get_engine().begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE ai_provider_config ("
                "id TEXT PRIMARY KEY, kind TEXT, model TEXT, base_url TEXT)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO ai_provider_config (id, kind, model, base_url) "
                "VALUES ('default', 'openai_compatible', 'llama3.1', 'http://localhost:11434/v1')"
            )
        )


def test_creates_a_fresh_schema_with_the_column() -> None:
    bootstrap_database()

    columns = {column["name"] for column in inspect(get_engine()).get_columns("ai_provider_config")}
    assert "context_window" in columns


def test_adds_the_column_to_a_pre_migration_database_keeping_the_row() -> None:
    _create_pre_migration_table()

    bootstrap_database()

    # The column is added, the existing row survives, and its new field reads as unset.
    config = SqlAiConfigRepository(get_session_factory()).get()
    assert config is not None
    assert config.model == "llama3.1"
    assert config.context_window is None


def test_migration_is_idempotent_and_preserves_a_set_window() -> None:
    bootstrap_database()
    repository = SqlAiConfigRepository(get_session_factory())
    repository.set(
        AiProviderConfig(
            kind=AiProviderKind.OPENAI_COMPATIBLE,
            model="llama3.1",
            base_url="http://localhost:11434/v1",
            context_window=8192,
        )
    )

    bootstrap_database()  # a second start-up must not disturb the stored value

    assert repository.get().context_window == 8192  # type: ignore[union-attr]
