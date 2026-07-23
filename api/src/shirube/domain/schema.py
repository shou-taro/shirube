"""Domain types for an introspected database schema.

These describe the schema as a graph — objects are the nodes and foreign keys the
edges — which is exactly what the ER map draws. They are plain data, independent of how
they were read (PostgreSQL today) or how they are rendered.
"""

from dataclasses import dataclass, field
from enum import StrEnum


class ObjectKind(StrEnum):
    """The kind of schema object shown on the map.

    A partitioned table is shown as a single node standing in for the whole table; its
    child partitions are folded away (see :class:`Partition`). Foreign tables are still
    out of scope for now.
    """

    TABLE = "table"
    VIEW = "view"
    MATERIALIZED_VIEW = "materialized_view"
    PARTITIONED_TABLE = "partitioned_table"


class RelationshipKind(StrEnum):
    """What connects two objects on the map.

    A foreign key ties a referencing table to the one it points at; a view dependency
    ties a view (or materialized view) to a relation it reads from. Both are drawn as
    directed edges, source → target, but they are styled apart.
    """

    FOREIGN_KEY = "foreign_key"
    VIEW_DEPENDENCY = "view_dependency"


@dataclass(frozen=True, slots=True)
class Column:
    """A single column of a table or view.

    Attributes:
        name: Column name.
        data_type: Human-readable SQL type (e.g. ``integer``, ``character varying(255)``).
        nullable: Whether the column accepts NULL.
        is_primary_key: Whether the column is part of the primary key.
        comment: The column's database comment (``COMMENT ON COLUMN``), or ``None``.
    """

    name: str
    data_type: str
    nullable: bool
    is_primary_key: bool = False
    comment: str | None = None


@dataclass(frozen=True, slots=True)
class Partition:
    """One child partition of a partitioned table.

    A partitioned table is shown as a single node, so its children never appear on the
    map; they are listed against the parent instead, to show *how* it is split.

    Attributes:
        name: The child partition's table name.
        bound: The range, list or hash the partition holds, as PostgreSQL renders it
            (e.g. ``FROM ('2022-01-01') TO ('2022-02-01')``, ``IN ('a', 'b')``,
            ``WITH (modulus 4, remainder 0)`` or ``DEFAULT``), or ``None`` if unknown.
    """

    name: str
    bound: str | None = None


@dataclass(frozen=True, slots=True)
class SchemaObject:
    """A table, view or materialized view — one node on the map.

    Attributes:
        schema: The schema (namespace) the object lives in.
        name: The object's name, unique within its schema.
        kind: Whether it is a table, view, materialized view or partitioned table.
        columns: The object's columns, in definition order.
        row_estimate: The catalogue's estimated row count (``pg_class.reltuples``), or
            ``None`` when unknown (e.g. never analysed, or a plain view). An estimate, not
            a scan — the only numeric signal the AI navigator is given, and never exact.
            For a partitioned table it is the sum of its children's estimates.
        partitions: For a partitioned table, its child partitions; empty otherwise. The
            children are folded behind this node rather than shown separately.
    """

    schema: str
    name: str
    kind: ObjectKind
    columns: tuple[Column, ...] = field(default_factory=tuple)
    row_estimate: int | None = None
    partitions: tuple[Partition, ...] = field(default_factory=tuple)

    @property
    def id(self) -> str:
        """A stable ``schema.name`` identifier, unique within the database."""
        return f"{self.schema}.{self.name}"


@dataclass(frozen=True, slots=True)
class Relationship:
    """A directed relationship between two objects — one edge on the map.

    Covers both foreign keys and view dependencies (see :class:`RelationshipKind`).
    ``source_columns`` and ``target_columns`` describe a foreign key's joined columns and
    are empty for a view dependency, which has no columns of its own.

    Attributes:
        constraint_name: The foreign-key constraint's name, or a synthesised ``source →
            target`` identifier for a view dependency. Unique per edge either way.
        source: ``schema.name`` id of the referencing object (the view, for a dependency).
        source_columns: The referencing columns, in key order (empty for a dependency).
        target: ``schema.name`` id of the referenced object.
        target_columns: The referenced columns, matching ``source_columns`` by position
            (empty for a dependency).
        kind: Whether this is a foreign key or a view dependency.
    """

    constraint_name: str
    source: str
    source_columns: tuple[str, ...]
    target: str
    target_columns: tuple[str, ...]
    kind: RelationshipKind = RelationshipKind.FOREIGN_KEY


@dataclass(frozen=True, slots=True)
class SchemaGraph:
    """The whole introspected schema: objects (nodes) and relationships (edges)."""

    objects: tuple[SchemaObject, ...] = field(default_factory=tuple)
    relationships: tuple[Relationship, ...] = field(default_factory=tuple)
