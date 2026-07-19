"""Schema introspection proven against a real PostgreSQL.

shirube's whole job is making sense of awkward, legacy schemas, so the inspector is
exercised against the shapes a tidy sample (like pagila) never has: composite, self- and
circular foreign keys, cross-schema references, view-of-view chains, exotic column types
and quoting-hostile identifiers. Each fixture is a throwaway schema, and `inspect` is
scoped to it so results can be asserted exactly.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

import psycopg
import pytest

from shirube.adapters.postgres.schema_inspector import PostgresSchemaInspector
from shirube.domain.connection import ConnectionParams
from shirube.domain.schema import (
    ObjectKind,
    Relationship,
    RelationshipKind,
    SchemaGraph,
    SchemaObject,
)

pytestmark = pytest.mark.integration


def _run(connection: psycopg.Connection, *statements: str) -> None:
    """Run each DDL statement in turn (the driver rejects multiple per execute)."""
    for statement in statements:
        connection.execute(statement)


def _inspect(params: ConnectionParams, *schemas: str) -> SchemaGraph:
    return PostgresSchemaInspector().inspect(params, list(schemas))


def _by_id(objects: Sequence[SchemaObject]) -> dict[str, SchemaObject]:
    return {obj.id: obj for obj in objects}


def _edges(relationships: Sequence[Relationship], source: str, target: str) -> list[Relationship]:
    return [r for r in relationships if r.source == source and r.target == target]


def test_reads_objects_columns_primary_keys_and_kinds(
    params: ConnectionParams,
    admin_connection: psycopg.Connection,
    make_schema: Callable[[], str],
) -> None:
    schema = make_schema()
    _run(
        admin_connection,
        f'CREATE TABLE "{schema}".t (id integer PRIMARY KEY, name text NOT NULL, note text)',
        f"COMMENT ON COLUMN \"{schema}\".t.name IS 'the display name'",
        f'CREATE VIEW "{schema}".v AS SELECT id, name FROM "{schema}".t',
        f'CREATE MATERIALIZED VIEW "{schema}".mv AS SELECT id FROM "{schema}".t',
    )

    objects = _by_id(_inspect(params, schema).objects)

    assert objects[f"{schema}.t"].kind is ObjectKind.TABLE
    assert objects[f"{schema}.v"].kind is ObjectKind.VIEW
    assert objects[f"{schema}.mv"].kind is ObjectKind.MATERIALIZED_VIEW

    columns = objects[f"{schema}.t"].columns
    # Columns keep definition order.
    assert [c.name for c in columns] == ["id", "name", "note"]
    assert columns[0].is_primary_key is True
    assert columns[0].nullable is False
    assert columns[0].data_type == "integer"
    assert columns[1].is_primary_key is False and columns[1].nullable is False
    assert columns[2].nullable is True
    # Column comments are read (metadata for the AI navigator); absent ones are None.
    assert columns[1].comment == "the display name"
    assert columns[0].comment is None
    # A freshly-created, never-analysed table reports no row estimate rather than a lie.
    assert objects[f"{schema}.t"].row_estimate in (None, 0)


def test_simple_and_composite_foreign_keys(
    params: ConnectionParams,
    admin_connection: psycopg.Connection,
    make_schema: Callable[[], str],
) -> None:
    schema = make_schema()
    _run(
        admin_connection,
        f'CREATE TABLE "{schema}".parent (id integer PRIMARY KEY, k1 integer, k2 integer, '
        "UNIQUE (k1, k2))",
        f'CREATE TABLE "{schema}".child ('
        "  id integer PRIMARY KEY,"
        f'  parent_id integer REFERENCES "{schema}".parent(id),'
        "  a integer, b integer,"
        f'  FOREIGN KEY (a, b) REFERENCES "{schema}".parent(k1, k2))',
    )

    relationships = _inspect(params, schema).relationships
    child, parent = f"{schema}.child", f"{schema}.parent"
    edges = _edges(relationships, child, parent)

    assert all(edge.kind is RelationshipKind.FOREIGN_KEY for edge in edges)
    columns = {edge.source_columns: edge.target_columns for edge in edges}
    assert columns[("parent_id",)] == ("id",)
    # Composite keys keep column order.
    assert columns[("a", "b")] == ("k1", "k2")


def test_self_referencing_foreign_key(
    params: ConnectionParams,
    admin_connection: psycopg.Connection,
    make_schema: Callable[[], str],
) -> None:
    schema = make_schema()
    _run(
        admin_connection,
        f'CREATE TABLE "{schema}".emp ('
        "  id integer PRIMARY KEY,"
        f'  manager_id integer REFERENCES "{schema}".emp(id))',
    )

    relationships = _inspect(params, schema).relationships
    emp = f"{schema}.emp"
    edges = _edges(relationships, emp, emp)

    assert len(edges) == 1
    assert edges[0].source_columns == ("manager_id",)
    assert edges[0].target_columns == ("id",)


def test_circular_foreign_keys(
    params: ConnectionParams,
    admin_connection: psycopg.Connection,
    make_schema: Callable[[], str],
) -> None:
    schema = make_schema()
    _run(
        admin_connection,
        f'CREATE TABLE "{schema}".a (id integer PRIMARY KEY, b_id integer)',
        f'CREATE TABLE "{schema}".b (id integer PRIMARY KEY, a_id integer)',
        f'ALTER TABLE "{schema}".a ADD FOREIGN KEY (b_id) REFERENCES "{schema}".b(id)',
        f'ALTER TABLE "{schema}".b ADD FOREIGN KEY (a_id) REFERENCES "{schema}".a(id)',
    )

    relationships = _inspect(params, schema).relationships
    a, b = f"{schema}.a", f"{schema}.b"

    assert len(_edges(relationships, a, b)) == 1
    assert len(_edges(relationships, b, a)) == 1


def test_cross_schema_foreign_key_and_scoping(
    params: ConnectionParams,
    admin_connection: psycopg.Connection,
    make_schema: Callable[[], str],
) -> None:
    s1, s2 = make_schema(), make_schema()
    _run(
        admin_connection,
        f'CREATE TABLE "{s1}".parent (id integer PRIMARY KEY)',
        f'CREATE TABLE "{s2}".child (id integer PRIMARY KEY, pid integer '
        f'REFERENCES "{s1}".parent(id))',
    )

    # With both schemas loaded, the cross-schema edge is present.
    both = _inspect(params, s1, s2).relationships
    assert _edges(both, f"{s2}.child", f"{s1}.parent")

    # Scoped to only the child's schema, the edge is dropped — its target is off-map.
    scoped = _inspect(params, s2)
    assert scoped.relationships == ()
    assert {o.id for o in scoped.objects} == {f"{s2}.child"}


def test_view_dependency_chain(
    params: ConnectionParams,
    admin_connection: psycopg.Connection,
    make_schema: Callable[[], str],
) -> None:
    schema = make_schema()
    _run(
        admin_connection,
        f'CREATE TABLE "{schema}".base (id integer)',
        f'CREATE VIEW "{schema}".v1 AS SELECT id FROM "{schema}".base',
        f'CREATE VIEW "{schema}".v2 AS SELECT id FROM "{schema}".v1',
    )

    relationships = _inspect(params, schema).relationships
    deps = [r for r in relationships if r.kind is RelationshipKind.VIEW_DEPENDENCY]
    pairs = {(r.source, r.target) for r in deps}

    assert (f"{schema}.v1", f"{schema}.base") in pairs
    assert (f"{schema}.v2", f"{schema}.v1") in pairs


def test_exotic_column_types_are_formatted(
    params: ConnectionParams,
    admin_connection: psycopg.Connection,
    make_schema: Callable[[], str],
) -> None:
    schema = make_schema()
    _run(
        admin_connection,
        f'CREATE TABLE "{schema}".x ('
        "  arr integer[],"
        "  j jsonb,"
        "  u uuid,"
        "  ts timestamptz,"
        "  num numeric(10, 2))",
    )

    columns = {
        c.name: c.data_type for c in _by_id(_inspect(params, schema).objects)[f"{schema}.x"].columns
    }

    assert columns["arr"] == "integer[]"
    assert columns["j"] == "jsonb"
    assert columns["u"] == "uuid"
    assert columns["ts"] == "timestamp with time zone"
    assert columns["num"] == "numeric(10,2)"


def test_quoting_hostile_and_unicode_identifiers(
    params: ConnectionParams,
    admin_connection: psycopg.Connection,
    make_schema: Callable[[], str],
) -> None:
    schema = make_schema()
    # A table whose name embeds a double quote, a reserved-word column, and a Unicode one.
    _run(
        admin_connection,
        f'CREATE TABLE "{schema}"."we""ird" ("select" integer, "columnα" text)',
    )

    objects = _by_id(_inspect(params, schema).objects)
    table = objects[f'{schema}.we"ird']

    assert table.name == 'we"ird'
    assert [c.name for c in table.columns] == ["select", "columnα"]


def test_legacy_schema_without_foreign_keys(
    params: ConnectionParams,
    admin_connection: psycopg.Connection,
    make_schema: Callable[[], str],
) -> None:
    schema = make_schema()
    _run(
        admin_connection,
        f'CREATE TABLE "{schema}".a (id integer)',
        f'CREATE TABLE "{schema}".b (id integer)',
    )

    graph = _inspect(params, schema)

    assert {o.id for o in graph.objects} == {f"{schema}.a", f"{schema}.b"}
    assert graph.relationships == ()
