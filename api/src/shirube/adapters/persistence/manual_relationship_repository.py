"""SQLAlchemy implementation of the manual-relationship repository.

Manual relationships are local annotations — links the user drew that the database does
not declare — scoped to a connection profile. Each method runs in its own short session,
like the other repositories: these are infrequent, independent operations for a single
user.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from shirube.adapters.persistence.models import ManualRelationshipRow
from shirube.domain.schema import ManualRelationship


def _to_domain(row: ManualRelationshipRow) -> ManualRelationship:
    """Map a persisted row to a domain :class:`ManualRelationship`."""
    return ManualRelationship(
        id=row.id,
        profile_id=row.profile_id,
        source_schema=row.source_schema,
        source_table=row.source_table,
        source_column=row.source_column,
        target_schema=row.target_schema,
        target_table=row.target_table,
        target_column=row.target_column,
    )


class SqlManualRelationshipRepository:
    """Stores user-drawn relationships in the local app-state database."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def list_for_profile(self, profile_id: str) -> list[ManualRelationship]:
        """Return every manual relationship saved for a profile."""
        with self._session_factory() as session:
            rows = session.scalars(
                select(ManualRelationshipRow).where(ManualRelationshipRow.profile_id == profile_id)
            ).all()
            return [_to_domain(row) for row in rows]

    def get(self, relationship_id: str) -> ManualRelationship | None:
        """Return one manual relationship, or ``None`` if it does not exist."""
        with self._session_factory() as session:
            row = session.get(ManualRelationshipRow, relationship_id)
            return _to_domain(row) if row is not None else None

    def add(self, relationship: ManualRelationship) -> None:
        """Insert a new manual relationship."""
        with self._session_factory() as session:
            session.add(
                ManualRelationshipRow(
                    id=relationship.id,
                    profile_id=relationship.profile_id,
                    source_schema=relationship.source_schema,
                    source_table=relationship.source_table,
                    source_column=relationship.source_column,
                    target_schema=relationship.target_schema,
                    target_table=relationship.target_table,
                    target_column=relationship.target_column,
                )
            )
            session.commit()

    def delete(self, relationship_id: str) -> None:
        """Delete a manual relationship; a no-op if it does not exist."""
        with self._session_factory() as session:
            row = session.get(ManualRelationshipRow, relationship_id)
            if row is not None:
                session.delete(row)
                session.commit()
