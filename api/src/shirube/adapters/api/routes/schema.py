"""Schema-introspection endpoint.

Returns a connected database's schema as a graph — objects (nodes) and foreign-key
relationships (edges) — for the ER map to draw.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from shirube.adapters.api.dependencies import get_schema_service
from shirube.application.schema import SchemaService
from shirube.domain.schema import ObjectKind, SchemaGraph, SchemaObject

router = APIRouter(prefix="/profiles", tags=["schema"])


class ColumnRead(BaseModel):
    """A column of an object."""

    name: str
    data_type: str
    nullable: bool
    is_primary_key: bool


class ObjectRead(BaseModel):
    """A table, view or materialized view — one node on the map."""

    # ``schema`` shadows a BaseModel attribute, so hold it under a safe name and expose
    # it as "schema" in the JSON.
    model_config = ConfigDict(populate_by_name=True)

    id: str
    schema_name: str = Field(serialization_alias="schema")
    name: str
    kind: ObjectKind
    columns: list[ColumnRead]

    @classmethod
    def from_domain(cls, obj: SchemaObject) -> "ObjectRead":
        """Build the response model from a domain object."""
        return cls(
            id=obj.id,
            schema_name=obj.schema,
            name=obj.name,
            kind=obj.kind,
            columns=[
                ColumnRead(
                    name=column.name,
                    data_type=column.data_type,
                    nullable=column.nullable,
                    is_primary_key=column.is_primary_key,
                )
                for column in obj.columns
            ],
        )


class RelationshipRead(BaseModel):
    """A foreign-key relationship — one edge on the map."""

    constraint_name: str
    source: str
    source_columns: list[str]
    target: str
    target_columns: list[str]


class SchemaRead(BaseModel):
    """The whole schema as objects and relationships."""

    objects: list[ObjectRead]
    relationships: list[RelationshipRead]

    @classmethod
    def from_graph(cls, graph: SchemaGraph) -> "SchemaRead":
        """Build the response model from a domain schema graph."""
        return cls(
            objects=[ObjectRead.from_domain(obj) for obj in graph.objects],
            relationships=[
                RelationshipRead(
                    constraint_name=relationship.constraint_name,
                    source=relationship.source,
                    source_columns=list(relationship.source_columns),
                    target=relationship.target,
                    target_columns=list(relationship.target_columns),
                )
                for relationship in graph.relationships
            ],
        )


ServiceDep = Annotated[SchemaService, Depends(get_schema_service)]


@router.get("/{profile_id}/schema", response_model=SchemaRead)
def get_schema(profile_id: str, service: ServiceDep) -> SchemaRead:
    """Introspect a saved profile's database and return its schema graph.

    A missing profile surfaces as 404; an unreachable or unreadable database as 400 with
    a translated, actionable message.
    """
    return SchemaRead.from_graph(service.introspect_profile(profile_id))
