"""Result types for the AI navigator's schema look-up tools.

These are what the four read-only look-up tools return (see
:class:`~shirube.application.lookup.SchemaLookup`). They carry **metadata only** — names,
kinds, types, keys, comments, relationship structure and count *estimates* — and never
row data or column values. That is the contract that keeps the AI navigator "never
dangerous": it reasons over the shape of the schema and proposes, while a human clicks
through to the actual data.

They are plain, frozen data, independent of any provider; serialising them into a
particular model's tool-call JSON is the provider adapter's job.
"""

from dataclasses import dataclass, field

from shirube.domain.schema import Column, ObjectKind, RelationshipKind


@dataclass(frozen=True, slots=True)
class ObjectHit:
    """One ranked match from :meth:`SchemaLookup.search_objects`.

    The entry point for "which table do I start from" — enough to decide whether an object
    is worth pulling full detail for, and nothing more.

    Attributes:
        id: The object's ``schema.name`` identifier.
        schema: The schema (namespace) it lives in.
        name: The object's name.
        kind: Table, view or materialized view.
        column_count: How many columns it has — a cheap size signal.
        row_estimate: The catalogue's estimated row count, or ``None`` if unknown.
        matched_column: The column whose name matched, when the hit came from a column
            rather than the object's own name; ``None`` for a name match.
    """

    id: str
    schema: str
    name: str
    kind: ObjectKind
    column_count: int
    row_estimate: int | None = None
    matched_column: str | None = None


@dataclass(frozen=True, slots=True)
class RelationshipRef:
    """One relationship of an object, as seen from that object.

    A directed edge is presented relative to the object being viewed: ``related`` is the
    object at the *other* end, and ``columns`` / ``related_columns`` are this object's and
    the other object's joined columns (both empty for a view dependency, which has no
    columns of its own).

    Attributes:
        constraint_name: The foreign-key constraint name, or a synthesised identifier for
            a view dependency.
        related: The ``schema.name`` id of the object at the other end.
        kind: Whether this is a foreign key or a view dependency.
        columns: This object's columns involved in the relationship, in key order.
        related_columns: The other object's columns, matching ``columns`` by position.
    """

    constraint_name: str
    related: str
    kind: RelationshipKind
    columns: tuple[str, ...] = ()
    related_columns: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ObjectDetail:
    """Full metadata for one object, from :meth:`SchemaLookup.get_object`.

    The map's table detail, for the AI: columns plus relationships split by direction.
    ``references`` are the objects this one points at (its outgoing foreign keys and the
    relations a view reads); ``referenced_by`` are the objects that point at it.

    Attributes:
        id: The object's ``schema.name`` identifier.
        schema: The schema (namespace) it lives in.
        name: The object's name.
        kind: Table, view or materialized view.
        row_estimate: The catalogue's estimated row count, or ``None`` if unknown.
        columns: The object's columns, in definition order (metadata only — no values).
        references: Relationships where this object is the source.
        referenced_by: Relationships where this object is the target.
    """

    id: str
    schema: str
    name: str
    kind: ObjectKind
    row_estimate: int | None
    columns: tuple[Column, ...] = ()
    references: tuple[RelationshipRef, ...] = ()
    referenced_by: tuple[RelationshipRef, ...] = ()


@dataclass(frozen=True, slots=True)
class PathResult:
    """The relationship path between two objects, from :meth:`SchemaLookup.find_path`.

    ``hops`` is the sequence of ``schema.name`` ids from the source to the target
    inclusive — ``(source,)`` when the two are the same object, and empty when the target
    is unreachable from the source. Edges are walked **undirected**: a path answers "how
    are these related", regardless of which way each foreign key points.

    Attributes:
        hops: The object ids along the shortest path, source → target inclusive; empty if
            unreachable.
    """

    hops: tuple[str, ...] = ()

    @property
    def found(self) -> bool:
        """Whether a path exists (``True`` when there is at least one hop)."""
        return len(self.hops) > 0


@dataclass(frozen=True, slots=True)
class SchemaSummary:
    """One schema's name and object count, from :meth:`SchemaLookup.list_schemas`.

    Cheap orientation on a multi-schema database.

    Attributes:
        schema: The schema (namespace) name.
        object_count: How many tables, views and materialized views it holds.
    """

    schema: str
    object_count: int = field(default=0)
