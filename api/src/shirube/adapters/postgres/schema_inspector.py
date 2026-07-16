"""PostgreSQL schema introspection adapter.

Reads objects, columns and foreign keys straight from the PostgreSQL system catalogues
and assembles them into a :class:`~shirube.domain.schema.SchemaGraph`. Splitting the row
mapping out into :func:`build_graph` keeps that logic pure and testable without a live
database; only :meth:`PostgresSchemaInspector.inspect` needs a real connection.
"""

from collections.abc import Sequence
from typing import Any

from psycopg.rows import dict_row

from shirube.adapters.postgres._common import read_only_connection
from shirube.domain.connection import ConnectionParams
from shirube.domain.schema import (
    Column,
    ObjectKind,
    Relationship,
    RelationshipKind,
    SchemaGraph,
    SchemaObject,
)

# PostgreSQL ``relkind`` codes for the objects shown on the map. Foreign tables ('f')
# and partition parents ('p') are intentionally left out.
_KIND_BY_RELKIND = {
    "r": ObjectKind.TABLE,
    "v": ObjectKind.VIEW,
    "m": ObjectKind.MATERIALIZED_VIEW,
}


def _schema_filter(alias: str) -> str:
    """A WHERE fragment restricting a namespace to the requested (non-system) schemas.

    An empty ``schemas`` array means "all non-system schemas"; otherwise restrict to the
    named ones. Parameterised on the namespace table's alias so the same rule applies to
    each query. ``%%`` escapes the literal ``%`` for psycopg's parameter substitution.
    """
    return (
        f"{alias}.nspname NOT IN ('pg_catalog', 'information_schema') "
        f"AND {alias}.nspname NOT LIKE 'pg_%%' "
        f"AND (cardinality(%(schemas)s::text[]) = 0 "
        f"OR {alias}.nspname = ANY(%(schemas)s::text[]))"
    )


_OBJECTS_SQL = f"""
    SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'v', 'm') AND {_schema_filter("n")}
    ORDER BY n.nspname, c.relname
"""

_COLUMNS_SQL = f"""
    SELECT n.nspname AS schema,
           c.relname AS "table",
           a.attname AS name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
           NOT a.attnotnull AS nullable,
           COALESCE(pk.is_primary_key, false) AS is_primary_key
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN (
        SELECT conrelid, unnest(conkey) AS attnum, true AS is_primary_key
        FROM pg_catalog.pg_constraint
        WHERE contype = 'p'
    ) pk ON pk.conrelid = a.attrelid AND pk.attnum = a.attnum
    WHERE c.relkind IN ('r', 'v', 'm')
      AND a.attnum > 0 AND NOT a.attisdropped
      AND {_schema_filter("n")}
    ORDER BY n.nspname, c.relname, a.attnum
"""

_RELATIONSHIPS_SQL = f"""
    SELECT con.conname AS constraint_name,
           n.nspname AS source_schema,
           sc.relname AS source_table,
           tn.nspname AS target_schema,
           tc.relname AS target_table,
           (SELECT array_agg(a.attname ORDER BY k.ord)
              FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_catalog.pg_attribute a
                ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS source_columns,
           (SELECT array_agg(a.attname ORDER BY k.ord)
              FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_catalog.pg_attribute a
                ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS target_columns
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class sc ON sc.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = sc.relnamespace
    JOIN pg_catalog.pg_class tc ON tc.oid = con.confrelid
    JOIN pg_catalog.pg_namespace tn ON tn.oid = tc.relnamespace
    WHERE con.contype = 'f' AND {_schema_filter("n")}
    ORDER BY con.conname
"""

# The relations each view (or materialized view) reads from. A view's SELECT lives in a
# rewrite rule (pg_rewrite), and pg_depend records that rule's dependencies on the
# relations it touches; DISTINCT collapses the per-column duplicates, and excluding the
# view's own oid drops the rule's self-dependency.
_VIEW_DEPENDENCIES_SQL = f"""
    SELECT DISTINCT
           vn.nspname AS view_schema,
           v.relname  AS view_name,
           dn.nspname AS ref_schema,
           d.relname  AS ref_name
    FROM pg_catalog.pg_rewrite rw
    JOIN pg_catalog.pg_class v ON v.oid = rw.ev_class
    JOIN pg_catalog.pg_namespace vn ON vn.oid = v.relnamespace
    JOIN pg_catalog.pg_depend dep
      ON dep.objid = rw.oid
     AND dep.classid = 'pg_rewrite'::regclass
     AND dep.refclassid = 'pg_class'::regclass
     AND dep.deptype = 'n'
    JOIN pg_catalog.pg_class d ON d.oid = dep.refobjid
    JOIN pg_catalog.pg_namespace dn ON dn.oid = d.relnamespace
    WHERE v.relkind IN ('v', 'm')
      AND d.relkind IN ('r', 'v', 'm')
      AND d.oid <> v.oid
      AND {_schema_filter("vn")}
    ORDER BY view_schema, view_name, ref_schema, ref_name
"""


def build_graph(
    object_rows: Sequence[dict[str, Any]],
    column_rows: Sequence[dict[str, Any]],
    relationship_rows: Sequence[dict[str, Any]],
    dependency_rows: Sequence[dict[str, Any]] = (),
) -> SchemaGraph:
    """Assemble query rows into a :class:`SchemaGraph`.

    Columns are attached to their object by ``(schema, name)``, preserving the order the
    rows arrive in. A relationship is kept only when both endpoints are among the loaded
    objects, so the graph never carries an edge to a node it does not contain (e.g. a
    foreign key into a schema that was not requested, or a view reading such a table).
    Foreign keys come first, then view dependencies.

    Args:
        object_rows: Rows of ``schema``, ``name`` and ``kind`` (a relkind code).
        column_rows: Rows of ``schema``, ``table``, ``name``, ``data_type``,
            ``nullable`` and ``is_primary_key``, ordered by object then position.
        relationship_rows: Rows of ``constraint_name``, the source/target schema and
            table, and ``source_columns``/``target_columns`` arrays.
        dependency_rows: Rows of ``view_schema``, ``view_name``, ``ref_schema`` and
            ``ref_name`` — one per relation a view reads from.

    Returns:
        The assembled schema graph.
    """
    columns_by_object: dict[tuple[str, str], list[Column]] = {}
    for row in column_rows:
        key = (row["schema"], row["table"])
        columns_by_object.setdefault(key, []).append(
            Column(
                name=row["name"],
                data_type=row["data_type"],
                nullable=row["nullable"],
                is_primary_key=row["is_primary_key"],
            )
        )

    objects = tuple(
        SchemaObject(
            schema=row["schema"],
            name=row["name"],
            kind=_KIND_BY_RELKIND[row["kind"]],
            columns=tuple(columns_by_object.get((row["schema"], row["name"]), ())),
        )
        for row in object_rows
        if row["kind"] in _KIND_BY_RELKIND
    )

    known_ids = {obj.id for obj in objects}
    foreign_keys = tuple(
        Relationship(
            constraint_name=row["constraint_name"],
            source=source,
            source_columns=tuple(row["source_columns"] or ()),
            target=target,
            target_columns=tuple(row["target_columns"] or ()),
        )
        for row in relationship_rows
        if (source := f"{row['source_schema']}.{row['source_table']}") in known_ids
        and (target := f"{row['target_schema']}.{row['target_table']}") in known_ids
    )
    view_dependencies = tuple(
        Relationship(
            constraint_name=f"{source}->{target}",
            source=source,
            source_columns=(),
            target=target,
            target_columns=(),
            kind=RelationshipKind.VIEW_DEPENDENCY,
        )
        for row in dependency_rows
        if (source := f"{row['view_schema']}.{row['view_name']}") in known_ids
        and (target := f"{row['ref_schema']}.{row['ref_name']}") in known_ids
        and source != target
    )

    return SchemaGraph(objects=objects, relationships=foreign_keys + view_dependencies)


class PostgresSchemaInspector:
    """Introspects a PostgreSQL database into a :class:`SchemaGraph`."""

    def inspect(self, params: ConnectionParams, schemas: Sequence[str]) -> SchemaGraph:
        """Read objects, columns, foreign keys and view dependencies from the database.

        Args:
            params: How to connect.
            schemas: Schemas to include; empty means all non-system schemas.

        Returns:
            The schema as a graph of objects and relationships.

        Raises:
            ConnectionFailedError: if the database cannot be reached or read.
        """
        query_params = {"schemas": list(schemas)}
        with read_only_connection(params) as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(_OBJECTS_SQL, query_params)
                object_rows = cursor.fetchall()
                cursor.execute(_COLUMNS_SQL, query_params)
                column_rows = cursor.fetchall()
                cursor.execute(_RELATIONSHIPS_SQL, query_params)
                relationship_rows = cursor.fetchall()
                cursor.execute(_VIEW_DEPENDENCIES_SQL, query_params)
                dependency_rows = cursor.fetchall()
        return build_graph(object_rows, column_rows, relationship_rows, dependency_rows)
