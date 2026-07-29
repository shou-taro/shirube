"""SQLAlchemy implementation of the connection-profile repository."""

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from shirube.adapters.persistence.models import ConnectionProfileRow
from shirube.domain.connection import (
    ConnectionProfile,
    DatabaseKind,
    DatabaseTarget,
    PostgresTarget,
    SqliteTarget,
    SslMode,
)

# Placeholders written into the server-only columns of a SQLite row, which has no host,
# port, user or SSL. The row's ``kind`` is ``sqlite``, so these are never read back.
_SQLITE_SERVER_PLACEHOLDERS = {"host": "", "port": 0, "database": "", "username": "", "sslmode": ""}


def _target_from_row(row: ConnectionProfileRow) -> DatabaseTarget:
    """Read the engine-specific target from a row, per its ``kind``.

    A missing ``kind`` (a row written before the column existed) is read as PostgreSQL.
    """
    if row.kind == DatabaseKind.SQLITE:
        return SqliteTarget(path=row.path or "")
    return PostgresTarget(
        host=row.host,
        port=row.port,
        database=row.database,
        username=row.username,
        sslmode=SslMode(row.sslmode),
    )


def _to_domain(row: ConnectionProfileRow) -> ConnectionProfile:
    """Map a persisted row to a domain :class:`ConnectionProfile`."""
    return ConnectionProfile(
        id=row.id,
        name=row.name,
        target=_target_from_row(row),
        schemas=tuple(row.schemas),
    )


def _target_columns(target: DatabaseTarget) -> dict[str, object]:
    """The per-engine column values for a target, filling the unused columns with placeholders.

    A SQLite row carries its path and leaves the server columns as placeholders; a PostgreSQL
    row carries the server columns and leaves ``path`` empty. Either way every column of the
    flat table gets a value, so the shape does not depend on the engine.
    """
    if isinstance(target, SqliteTarget):
        return {"path": target.path, **_SQLITE_SERVER_PLACEHOLDERS}
    return {
        "path": None,
        "host": target.host,
        "port": target.port,
        "database": target.database,
        "username": target.username,
        "sslmode": target.sslmode.value,
    }


def _to_row(profile: ConnectionProfile) -> ConnectionProfileRow:
    """Map a domain :class:`ConnectionProfile` to a persisted row."""
    return ConnectionProfileRow(
        id=profile.id,
        name=profile.name,
        kind=profile.kind.value,
        schemas=list(profile.schemas),
        **_target_columns(profile.target),
    )


class SqlProfileRepository:
    """Stores connection profiles in the local app-state database.

    Each method runs in its own short session — appropriate for a single-user local
    tool where these are infrequent, independent operations.
    """

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def list(self) -> list[ConnectionProfile]:
        """Return all profiles, ordered by name."""
        with self._session_factory() as session:
            rows = session.scalars(select(ConnectionProfileRow).order_by(ConnectionProfileRow.name))
            return [_to_domain(row) for row in rows]

    def get(self, profile_id: str) -> ConnectionProfile | None:
        """Return the profile with ``profile_id``, or ``None`` if there is none."""
        with self._session_factory() as session:
            row = session.get(ConnectionProfileRow, profile_id)
            return _to_domain(row) if row is not None else None

    def add(self, profile: ConnectionProfile) -> None:
        """Insert a new profile."""
        with self._session_factory() as session:
            session.add(_to_row(profile))
            session.commit()

    def update(self, profile: ConnectionProfile) -> None:
        """Overwrite the stored fields of an existing profile; a no-op if absent."""
        with self._session_factory() as session:
            row = session.get(ConnectionProfileRow, profile.id)
            if row is None:
                return
            row.name = profile.name
            row.kind = profile.kind.value
            row.schemas = list(profile.schemas)
            # Rewrite every engine column so switching a profile's kind cannot leave stale
            # values from the other engine behind (e.g. an old host on a now-SQLite row).
            for column, value in _target_columns(profile.target).items():
                setattr(row, column, value)
            session.commit()

    def delete(self, profile_id: str) -> None:
        """Delete a profile; a no-op if it does not exist."""
        with self._session_factory() as session:
            row = session.get(ConnectionProfileRow, profile_id)
            if row is not None:
                session.delete(row)
                session.commit()
