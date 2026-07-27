"""Use cases for the relationships a user draws that the database does not declare."""

from uuid import uuid4

from shirube.domain.errors import (
    DuplicateManualRelationshipError,
    InvalidManualRelationshipError,
    ManualRelationshipNotFoundError,
)
from shirube.domain.schema import ManualRelationship
from shirube.ports.repositories import ManualRelationshipRepository


class ManualRelationshipService:
    """Adds, lists and removes the manual relationships saved for a connection profile."""

    def __init__(self, repository: ManualRelationshipRepository) -> None:
        self._repository = repository

    def list(self, profile_id: str) -> list[ManualRelationship]:
        """Return every manual relationship saved for a profile."""
        return self._repository.list_for_profile(profile_id)

    def add(
        self,
        *,
        profile_id: str,
        source_schema: str,
        source_table: str,
        source_column: str,
        target_schema: str,
        target_table: str,
        target_column: str,
    ) -> ManualRelationship:
        """Save a new manual relationship for a profile.

        Args:
            profile_id: The connection profile the link belongs to.
            source_schema: Schema of the referencing table.
            source_table: The referencing table.
            source_column: The referencing column.
            target_schema: Schema of the referenced table.
            target_table: The referenced table.
            target_column: The referenced column.

        Returns:
            The created relationship, with its assigned id.

        Raises:
            InvalidManualRelationshipError: if the source and target are the same column.
            DuplicateManualRelationshipError: if the same link already exists for the profile.
        """
        relationship = ManualRelationship(
            id=str(uuid4()),
            profile_id=profile_id,
            source_schema=source_schema,
            source_table=source_table,
            source_column=source_column,
            target_schema=target_schema,
            target_table=target_table,
            target_column=target_column,
        )
        if (
            relationship.source_object_id == relationship.target_object_id
            and source_column == target_column
        ):
            raise InvalidManualRelationshipError
        if self._is_duplicate(relationship):
            raise DuplicateManualRelationshipError
        self._repository.add(relationship)
        return relationship

    def delete(self, profile_id: str, relationship_id: str) -> None:
        """Delete a manual relationship belonging to a profile.

        Args:
            profile_id: The profile the relationship must belong to.
            relationship_id: The relationship to delete.

        Raises:
            ManualRelationshipNotFoundError: if no such relationship exists for the profile.
        """
        existing = self._repository.get(relationship_id)
        # Scope the delete to the profile: a relationship id from another profile must not be
        # deletable through this one, and a missing id reads the same way — not found.
        if existing is None or existing.profile_id != profile_id:
            raise ManualRelationshipNotFoundError
        self._repository.delete(relationship_id)

    def _is_duplicate(self, candidate: ManualRelationship) -> bool:
        """Whether an identical link (same endpoints and columns) already exists."""
        for existing in self._repository.list_for_profile(candidate.profile_id):
            if (
                existing.source_object_id == candidate.source_object_id
                and existing.source_column == candidate.source_column
                and existing.target_object_id == candidate.target_object_id
                and existing.target_column == candidate.target_column
            ):
                return True
        return False
