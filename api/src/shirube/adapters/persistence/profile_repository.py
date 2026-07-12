"""SQLAlchemy implementation of the connection-profile repository."""

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from shirube.adapters.persistence.models import ConnectionProfileRow
from shirube.domain.connection import ConnectionProfile, SslMode


def _to_domain(row: ConnectionProfileRow) -> ConnectionProfile:
    """Map a persisted row to a domain :class:`ConnectionProfile`."""
    return ConnectionProfile(
        id=row.id,
        name=row.name,
        host=row.host,
        port=row.port,
        database=row.database,
        username=row.username,
        sslmode=SslMode(row.sslmode),
        schemas=tuple(row.schemas),
    )


def _to_row(profile: ConnectionProfile) -> ConnectionProfileRow:
    """Map a domain :class:`ConnectionProfile` to a persisted row."""
    return ConnectionProfileRow(
        id=profile.id,
        name=profile.name,
        host=profile.host,
        port=profile.port,
        database=profile.database,
        username=profile.username,
        sslmode=profile.sslmode.value,
        schemas=list(profile.schemas),
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
            row.host = profile.host
            row.port = profile.port
            row.database = profile.database
            row.username = profile.username
            row.sslmode = profile.sslmode.value
            row.schemas = list(profile.schemas)
            session.commit()

    def delete(self, profile_id: str) -> None:
        """Delete a profile; a no-op if it does not exist."""
        with self._session_factory() as session:
            row = session.get(ConnectionProfileRow, profile_id)
            if row is not None:
                session.delete(row)
                session.commit()
