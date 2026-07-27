"""Endpoints for the relationships a user draws that the database does not declare.

Reads go through the schema endpoint, which merges manual relationships into the graph as
``manual`` edges; these routes only create and delete them.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from shirube.adapters.api.dependencies import get_manual_relationship_service
from shirube.application.relationships import ManualRelationshipService
from shirube.domain.schema import ManualRelationship

router = APIRouter(prefix="/profiles", tags=["relationships"])


class ManualRelationshipCreate(BaseModel):
    """Request body for drawing a manual relationship, column to column."""

    source_schema: str
    source_table: str
    source_column: str
    target_schema: str
    target_table: str
    target_column: str


class ManualRelationshipRead(BaseModel):
    """A saved manual relationship, with its assigned id."""

    id: str
    source_schema: str
    source_table: str
    source_column: str
    target_schema: str
    target_table: str
    target_column: str

    @classmethod
    def from_domain(cls, relationship: ManualRelationship) -> "ManualRelationshipRead":
        """Build the response model from a domain manual relationship."""
        return cls(
            id=relationship.id,
            source_schema=relationship.source_schema,
            source_table=relationship.source_table,
            source_column=relationship.source_column,
            target_schema=relationship.target_schema,
            target_table=relationship.target_table,
            target_column=relationship.target_column,
        )


ServiceDep = Annotated[ManualRelationshipService, Depends(get_manual_relationship_service)]


@router.post(
    "/{profile_id}/relationships",
    response_model=ManualRelationshipRead,
    status_code=status.HTTP_201_CREATED,
)
def create_relationship(
    profile_id: str,
    body: ManualRelationshipCreate,
    service: ServiceDep,
) -> ManualRelationshipRead:
    """Draw a manual relationship for a profile.

    An unknown profile is 404; a link to a column that is the same as its source is refused
    as 400; an identical existing link as 409.
    """
    relationship = service.add(
        profile_id=profile_id,
        source_schema=body.source_schema,
        source_table=body.source_table,
        source_column=body.source_column,
        target_schema=body.target_schema,
        target_table=body.target_table,
        target_column=body.target_column,
    )
    return ManualRelationshipRead.from_domain(relationship)


@router.delete(
    "/{profile_id}/relationships/{relationship_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_relationship(
    profile_id: str,
    relationship_id: str,
    service: ServiceDep,
) -> None:
    """Remove a manual relationship; a missing one (or one of another profile) is 404."""
    service.delete(profile_id, relationship_id)
