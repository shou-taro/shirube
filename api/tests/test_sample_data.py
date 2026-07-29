"""Tests for first-run seeding of the bundled Chinook sample database.

The conftest points each test at a throwaway data directory and disables auto-seeding, so
these drive :func:`seed_sample_database` directly to prove it seeds once, stays idempotent,
respects a deletion, and never lets a failure escape.
"""

import pytest

from shirube.adapters.persistence import sample_data
from shirube.adapters.persistence.bootstrap import bootstrap_database
from shirube.adapters.persistence.database import get_session_factory
from shirube.adapters.persistence.profile_repository import SqlProfileRepository
from shirube.adapters.persistence.sample_data import (
    SAMPLE_PROFILE_ID,
    SAMPLE_PROFILE_NAME,
    sample_database_path,
    seed_sample_database,
)
from shirube.adapters.sqlite.schema_inspector import SqliteSchemaInspector
from shirube.domain.connection import SqliteConnectionParams, SqliteTarget


def _repository() -> SqlProfileRepository:
    return SqlProfileRepository(get_session_factory())


def test_first_run_seeds_the_sample_connection() -> None:
    bootstrap_database()

    seed_sample_database()

    profile = _repository().get(SAMPLE_PROFILE_ID)
    assert profile is not None
    assert profile.name == SAMPLE_PROFILE_NAME
    assert isinstance(profile.target, SqliteTarget)
    # The database was copied to a stable path in the data directory, and the profile
    # points at that copy — not into the (possibly ephemeral) installed package.
    assert profile.target.path == str(sample_database_path())
    assert sample_database_path().exists()


def test_the_seeded_sample_opens_and_reads_as_chinook() -> None:
    """End-to-end: the bundled file copies out and inspects to the real Chinook schema."""
    bootstrap_database()
    seed_sample_database()

    graph = SqliteSchemaInspector().inspect(
        SqliteConnectionParams(path=str(sample_database_path())),
        schemas=(),
    )
    names = {obj.name for obj in graph.objects}
    assert {"Album", "Artist", "Track"} <= names
    # Chinook declares real foreign keys, so the map has edges to draw.
    assert graph.relationships


def test_seeding_is_idempotent() -> None:
    bootstrap_database()

    seed_sample_database()
    seed_sample_database()

    matching = [profile for profile in _repository().list() if profile.id == SAMPLE_PROFILE_ID]
    assert len(matching) == 1


def test_seeding_respects_deletion() -> None:
    """A deleted sample does not come back — the one-time marker, not an emptiness check."""
    bootstrap_database()
    seed_sample_database()
    _repository().delete(SAMPLE_PROFILE_ID)

    seed_sample_database()

    assert _repository().get(SAMPLE_PROFILE_ID) is None


def test_a_seeding_failure_is_swallowed_and_retried_next_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failure mid-seed must not crash start-up, and must not mark the sample as seeded."""
    bootstrap_database()

    class _FailingRepository:
        def __init__(self, *args: object) -> None: ...

        def get(self, profile_id: str) -> None:
            return None

        def add(self, profile: object) -> None:
            raise RuntimeError("app-state database unavailable")

    monkeypatch.setattr(sample_data, "SqlProfileRepository", _FailingRepository)
    # Must not raise, even though the profile add fails.
    seed_sample_database()
    assert _repository().get(SAMPLE_PROFILE_ID) is None

    # The marker was not written, so a later healthy start-up seeds successfully.
    monkeypatch.undo()
    seed_sample_database()
    assert _repository().get(SAMPLE_PROFILE_ID) is not None
