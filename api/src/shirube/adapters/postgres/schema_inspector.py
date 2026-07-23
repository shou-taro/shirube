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
    Partition,
    Relationship,
    RelationshipKind,
    SchemaGraph,
    SchemaObject,
)

# PostgreSQL ``relkind`` codes for the objects shown on the map. A partitioned table ('p')
# is shown as a single node standing in for the whole table — its child partitions are
# excluded (they carry the same relationships as the parent and would only flood the map).
# Foreign tables ('f') are still left out.
_KIND_BY_RELKIND = {
    "r": ObjectKind.TABLE,
    "v": ObjectKind.VIEW,
    "m": ObjectKind.MATERIALIZED_VIEW,
    "p": ObjectKind.PARTITIONED_TABLE,
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
    SELECT n.nspname AS schema,
           c.relname AS name,
           c.relkind AS kind,
           c.reltuples::bigint AS row_estimate
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'v', 'm', 'p')
      AND NOT c.relispartition
      AND {_schema_filter("n")}
    ORDER BY n.nspname, c.relname
"""  # nosec B608

_COLUMNS_SQL = f"""
    SELECT n.nspname AS schema,
           c.relname AS "table",
           a.attname AS name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
           NOT a.attnotnull AS nullable,
           COALESCE(pk.is_primary_key, false) AS is_primary_key,
           pg_catalog.col_description(c.oid, a.attnum) AS comment
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN (
        SELECT conrelid, unnest(conkey) AS attnum, true AS is_primary_key
        FROM pg_catalog.pg_constraint
        WHERE contype = 'p'
    ) pk ON pk.conrelid = a.attrelid AND pk.attnum = a.attnum
    WHERE c.relkind IN ('r', 'v', 'm', 'p')
      AND NOT c.relispartition
      AND a.attnum > 0 AND NOT a.attisdropped
      AND {_schema_filter("n")}
    ORDER BY n.nspname, c.relname, a.attnum
"""  # nosec B608

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
"""  # nosec B608

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
"""  # nosec B608

# The child partitions of each partitioned table, with the range/list/hash each holds.
# ``pg_get_expr(relpartbound)`` renders the bound exactly as PostgreSQL would (the same
# form pg_dump emits), so it covers every partitioning strategy; a child's own reltuples
# gives the per-partition size, summed into the parent's estimate. Only declarative
# partitions (parent relkind 'p') are covered — legacy inheritance has no bound to read.
_PARTITIONS_SQL = f"""
    SELECT pn.nspname AS parent_schema,
           p.relname  AS parent_name,
           c.relname  AS child_name,
           pg_catalog.pg_get_expr(c.relpartbound, c.oid) AS bound,
           c.reltuples::bigint AS row_estimate
    FROM pg_catalog.pg_inherits i
    JOIN pg_catalog.pg_class p ON p.oid = i.inhparent
    JOIN pg_catalog.pg_namespace pn ON pn.oid = p.relnamespace
    JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid
    WHERE p.relkind = 'p' AND {_schema_filter("pn")}
    ORDER BY pn.nspname, p.relname, c.relname
"""  # nosec B608


def _row_estimate(value: Any) -> int | None:
    """Normalise a ``reltuples`` estimate: a negative value means "unknown" → ``None``.

    PostgreSQL stores ``-1`` for a relation never analysed (and plain views carry no
    meaningful count), so anything below zero is reported as no estimate rather than a
    misleading number.
    """
    if value is None:
        return None
    estimate = int(value)
    return estimate if estimate >= 0 else None


def _partition_bound(value: Any) -> str | None:
    """Tidy a raw ``pg_get_expr(relpartbound)`` value for display.

    PostgreSQL renders a bound as ``FOR VALUES <clause>`` (or the bare word ``DEFAULT``);
    the ``FOR VALUES`` prefix is noise once it sits under a "Partitions" heading, so it is
    dropped, leaving just the range, list or hash.
    """
    if not value:
        return None
    text = str(value).strip()
    prefix = "FOR VALUES "
    return text[len(prefix) :] if text.startswith(prefix) else text


def build_graph(
    object_rows: Sequence[dict[str, Any]],
    column_rows: Sequence[dict[str, Any]],
    relationship_rows: Sequence[dict[str, Any]],
    dependency_rows: Sequence[dict[str, Any]] = (),
    partition_rows: Sequence[dict[str, Any]] = (),
) -> SchemaGraph:
    """Assemble query rows into a :class:`SchemaGraph`.

    Columns are attached to their object by ``(schema, name)``, preserving the order the
    rows arrive in. A relationship is kept only when both endpoints are among the loaded
    objects, so the graph never carries an edge to a node it does not contain (e.g. a
    foreign key into a schema that was not requested, or a view reading such a table).
    Foreign keys come first, then view dependencies.

    Args:
        object_rows: Rows of ``schema``, ``name``, ``kind`` (a relkind code) and an
            optional ``row_estimate`` (the catalogue's ``reltuples``).
        column_rows: Rows of ``schema``, ``table``, ``name``, ``data_type``,
            ``nullable``, ``is_primary_key`` and an optional ``comment``, ordered by
            object then position.
        relationship_rows: Rows of ``constraint_name``, the source/target schema and
            table, and ``source_columns``/``target_columns`` arrays.
        dependency_rows: Rows of ``view_schema``, ``view_name``, ``ref_schema`` and
            ``ref_name`` — one per relation a view reads from.
        partition_rows: Rows of ``parent_schema``, ``parent_name``, ``child_name``,
            ``bound`` and ``row_estimate`` — one per child partition of a partitioned table.

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
                comment=row.get("comment"),
            )
        )

    # Group each partitioned table's children under it, and sum their estimates — the
    # parent's own reltuples is 0, so the children's sizes are what give it a row count.
    partitions_by_object: dict[tuple[str, str], list[Partition]] = {}
    partition_estimate: dict[tuple[str, str], int] = {}
    for row in partition_rows:
        key = (row["parent_schema"], row["parent_name"])
        partitions_by_object.setdefault(key, []).append(
            Partition(name=row["child_name"], bound=_partition_bound(row.get("bound")))
        )
        child_estimate = _row_estimate(row.get("row_estimate"))
        if child_estimate is not None:
            partition_estimate[key] = partition_estimate.get(key, 0) + child_estimate

    def _estimate(row: dict[str, Any], key: tuple[str, str]) -> int | None:
        # A partitioned parent reports no rows of its own, so fall back to its children's sum.
        own = _row_estimate(row.get("row_estimate"))
        return own if own else partition_estimate.get(key, own)

    objects = tuple(
        SchemaObject(
            schema=row["schema"],
            name=row["name"],
            kind=_KIND_BY_RELKIND[row["kind"]],
            columns=tuple(columns_by_object.get((row["schema"], row["name"]), ())),
            row_estimate=_estimate(row, (row["schema"], row["name"])),
            partitions=tuple(partitions_by_object.get((row["schema"], row["name"]), ())),
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
                cursor.execute(_PARTITIONS_SQL, query_params)
                partition_rows = cursor.fetchall()
        return build_graph(
            object_rows, column_rows, relationship_rows, dependency_rows, partition_rows
        )
