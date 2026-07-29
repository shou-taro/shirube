"""Seed a bundled sample database on first run, so shirube is explorable with no setup.

Without a database of their own — and without Docker for the PostgreSQL sample — a new user
has nothing to open. This copies the bundled Chinook SQLite database into the user's data
directory and adds a read-only saved connection pointing at it, so ``uvx shirube`` lands on
something explorable straight away.

The copy goes to a **stable** path in the data directory, not the package itself: ``uvx``
runs from an ephemeral virtual-environment whose path changes each invocation, so a profile
pointing into the installed package would break on the next run. Seeding is **once,
idempotent, and deletion-respecting** — a one-time marker (not "are there no profiles?")
decides whether to seed, so a sample the user deleted never comes back.

Seeding a *profile* is not *connecting*: the sample appears in the saved list, but shirube
still opens it only when the user picks it — the "no surprise connections" rule holds. The
SQLite adapter opens every file read-only, so the sample cannot be modified either.
"""

import shutil
from importlib import resources
from pathlib import Path

from shirube.adapters.persistence.database import get_session_factory
from shirube.adapters.persistence.profile_repository import SqlProfileRepository
from shirube.config import get_settings
from shirube.domain.connection import ConnectionProfile, SqliteTarget
from shirube.logging_config import get_logger

_logger = get_logger("shirube.sample")

# A fixed id (not a random UUID) so the seeded profile is recognisable and re-running can
# never add a second copy, even if the marker were lost.
SAMPLE_PROFILE_ID = "sample-chinook"
SAMPLE_PROFILE_NAME = "Sample database (Chinook)"

# The bundled database, addressed as package data so it resolves in an installed wheel.
_PACKAGE = "shirube.samples"
_RESOURCE = "chinook.sqlite"


def _samples_dir() -> Path:
    """The stable directory the sample database is copied into (beside the app-state file)."""
    return get_settings().data_dir / "samples"


def sample_database_path() -> Path:
    """The stable path the seeded profile points at."""
    return _samples_dir() / _RESOURCE


def _seeded_marker() -> Path:
    """The one-time marker whose presence means "already seeded — do not seed again"."""
    return _samples_dir() / ".chinook-seeded"


def seed_sample_database() -> None:
    """Copy the bundled Chinook database and add its saved connection — once.

    Safe to call on every start-up: the marker short-circuits after the first successful run,
    and the copy and the profile add are each skipped when already present, so a partial run
    (e.g. interrupted before the marker was written) simply completes next time. Any failure
    is logged and swallowed — seeding is a convenience and must never block start-up.
    """
    marker = _seeded_marker()
    if marker.exists():
        return
    try:
        _samples_dir().mkdir(parents=True, exist_ok=True)
        destination = sample_database_path()
        if not destination.exists():
            source = resources.files(_PACKAGE).joinpath(_RESOURCE)
            with resources.as_file(source) as source_path:
                shutil.copyfile(source_path, destination)

        repository = SqlProfileRepository(get_session_factory())
        if repository.get(SAMPLE_PROFILE_ID) is None:
            repository.add(
                ConnectionProfile(
                    id=SAMPLE_PROFILE_ID,
                    name=SAMPLE_PROFILE_NAME,
                    target=SqliteTarget(path=str(destination)),
                )
            )
        # Written last, so an interrupted seed retries rather than leaving the sample missing.
        marker.touch()
        _logger.info("sample_seeded", path=str(destination))
    except Exception:
        # A convenience feature must never take the whole server down with it.
        _logger.warning("sample_seed_failed", exc_info=True)
