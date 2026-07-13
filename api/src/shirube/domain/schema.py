"""Domain types for an introspected database schema.

These describe the schema as a graph — objects are the nodes and foreign keys the
edges — which is exactly what the ER map draws. They are plain data, independent of how
they were read (PostgreSQL today) or how they are rendered.
"""

from dataclasses import dataclass, field
from enum import StrEnum


class ObjectKind(StrEnum):
    """The kind of schema object shown on the map.

    Foreign tables and partition parents are deliberately out of scope for now.
    """

    TABLE = "table"
    VIEW = "view"
    MATERIALIZED_VIEW = "materialized_view"


@dataclass(frozen=True, slots=True)
class Column:
    """A single column of a table or view.

    Attributes:
        name: Column name.
        data_type: Human-readable SQL type (e.g. ``integer``, ``character varying(255)``).
        nullable: Whether the column accepts NULL.
        is_primary_key: Whether the column is part of the primary key.
    """

    name: str
    data_type: str
    nullable: bool
    is_primary_key: bool = False


@dataclass(frozen=True, slots=True)
class SchemaObject:
    """A table, view or materialized view — one node on the map.

    Attributes:
        schema: The schema (namespace) the object lives in.
        name: The object's name, unique within its schema.
        kind: Whether it is a table, view or materialized view.
        columns: The object's columns, in definition order.
    """

    schema: str
    name: str
    kind: ObjectKind
    columns: tuple[Column, ...] = field(default_factory=tuple)

    @property
    def id(self) -> str:
        """A stable ``schema.name`` identifier, unique within the database."""
        return f"{self.schema}.{self.name}"


@dataclass(frozen=True, slots=True)
class Relationship:
    """A foreign-key relationship between two objects — one edge on the map.

    Attributes:
        constraint_name: The foreign-key constraint's name.
        source: ``schema.name`` id of the referencing object.
        source_columns: The referencing columns, in key order.
        target: ``schema.name`` id of the referenced object.
        target_columns: The referenced columns, matching ``source_columns`` by position.
    """

    constraint_name: str
    source: str
    source_columns: tuple[str, ...]
    target: str
    target_columns: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SchemaGraph:
    """The whole introspected schema: objects (nodes) and relationships (edges)."""

    objects: tuple[SchemaObject, ...] = field(default_factory=tuple)
    relationships: tuple[Relationship, ...] = field(default_factory=tuple)
