"""SQLite schema introspection adapter.

Reads objects, columns and foreign keys from SQLite's own catalogue (``sqlite_master`` and
the ``PRAGMA`` table-valued functions) and assembles them into a
:class:`~shirube.domain.schema.SchemaGraph`. Splitting the row mapping out into
:func:`build_graph` keeps that logic pure and testable without a live database; only
:meth:`SqliteSchemaInspector.inspect` needs a real connection.

SQLite has a single, unnamed namespace whose real name is ``main``, so every object is
reported under that schema and object ids stay ``schema.name`` exactly as for PostgreSQL.
SQLite has no materialized views or declarative partitions, and its views do not expose
their dependencies through the catalogue, so the graph carries tables, views and foreign
keys only.
"""

from collections.abc import Sequence
from typing import Any

from shirube.adapters.sqlite._common import read_only_connection
from shirube.domain.connection import SqliteConnectionParams
from shirube.domain.schema import (
    Column,
    ObjectKind,
    Relationship,
    SchemaGraph,
    SchemaObject,
)

# SQLite's single namespace. Its genuine name is ``main`` (as in ``main.sqlite_master``), so
# using it keeps object ids in the same ``schema.name`` form the rest of shirube expects.
SQLITE_SCHEMA = "main"

_KIND_BY_TYPE = {
    "table": ObjectKind.TABLE,
    "view": ObjectKind.VIEW,
}

# The user tables and views, excluding SQLite's internal ``sqlite_*`` objects. ``type`` is
# either ``table`` or ``view``; ``ORDER BY`` gives the map a stable object order.
_OBJECTS_SQL = """
    SELECT name, type
    FROM sqlite_master
    WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
    ORDER BY name
"""

# One row per column of an object. ``pragma_table_info`` is the table-valued form, so the
# object name binds as a parameter rather than being interpolated into SQL text.
_COLUMNS_SQL = """
    SELECT name, type AS data_type, "notnull" AS not_null, pk
    FROM pragma_table_info(?)
"""

# One row per foreign-key column. ``id`` groups the columns of a single (possibly composite)
# key and ``seq`` orders them; ``"table"``/``"from"``/``"to"`` are the referenced table and
# the joined columns. Bound via the table-valued ``pragma_foreign_key_list`` form.
_FOREIGN_KEYS_SQL = """
    SELECT id, seq, "table" AS target_table, "from" AS from_column, "to" AS to_column
    FROM pragma_foreign_key_list(?)
    ORDER BY id, seq
"""


def build_graph(
    object_rows: Sequence[dict[str, Any]],
    column_rows: Sequence[dict[str, Any]],
    foreign_key_rows: Sequence[dict[str, Any]],
) -> SchemaGraph:
    """Assemble SQLite catalogue rows into a :class:`SchemaGraph`.

    Columns are attached to their object by name, in the order the rows arrive. A foreign key
    is kept only when both its endpoints are among the loaded objects, so the graph never
    carries an edge to a node it does not contain. Composite keys — several rows sharing an
    ``id`` — are folded into one edge with ordered column tuples.

    Args:
        object_rows: Rows of ``name`` and ``type`` (``table`` or ``view``).
        column_rows: Rows of ``table``, ``name``, ``data_type``, ``not_null`` and ``pk`` —
            one per column, in position order (``pk`` is 0 when the column is not part of the
            primary key, or its 1-based position within a composite key otherwise).
        foreign_key_rows: Rows of ``source_table``, ``id``, ``target_table``, ``from_column``
            and ``to_column`` — one per foreign-key column, grouped by ``id`` and ordered by
            ``seq`` within it.

    Returns:
        The assembled schema graph.
    """
    columns_by_object: dict[str, list[Column]] = {}
    for row in column_rows:
        columns_by_object.setdefault(row["table"], []).append(
            Column(
                name=row["name"],
                # SQLite allows a column with no declared type (dynamic typing); show it blank
                # rather than inventing one.
                data_type=row["data_type"] or "",
                nullable=not row["not_null"],
                is_primary_key=bool(row["pk"]),
            )
        )

    objects = tuple(
        SchemaObject(
            schema=SQLITE_SCHEMA,
            name=row["name"],
            kind=_KIND_BY_TYPE[row["type"]],
            columns=tuple(columns_by_object.get(row["name"], ())),
            # SQLite keeps no catalogue row estimate, and counting would mean a full scan, so
            # the map simply shows no count for SQLite objects.
            row_estimate=None,
        )
        for row in object_rows
        if row["type"] in _KIND_BY_TYPE
    )

    known_ids = {obj.id for obj in objects}
    # Group the per-column foreign-key rows into one relationship per (source table, id). The
    # rows arrive ordered by id then seq, so appending preserves the key's column order.
    grouped: dict[tuple[str, int], dict[str, Any]] = {}
    for row in foreign_key_rows:
        key = (row["source_table"], row["id"])
        group = grouped.setdefault(
            key,
            {"target_table": row["target_table"], "source_columns": [], "target_columns": []},
        )
        group["source_columns"].append(row["from_column"])
        group["target_columns"].append(row["to_column"])

    relationships: list[Relationship] = []
    for (source_table, fk_id), group in grouped.items():
        source = f"{SQLITE_SCHEMA}.{source_table}"
        target = f"{SQLITE_SCHEMA}.{group['target_table']}"
        if source not in known_ids or target not in known_ids:
            continue
        relationships.append(
            Relationship(
                # SQLite foreign keys are unnamed; synthesise a stable id from the source and
                # the key's ordinal so each edge has a unique constraint_name.
                constraint_name=f"{source_table}_fk_{fk_id}",
                source=source,
                source_columns=tuple(group["source_columns"]),
                target=target,
                target_columns=tuple(group["target_columns"]),
            )
        )

    return SchemaGraph(objects=objects, relationships=tuple(relationships))


class SqliteSchemaInspector:
    """Introspects a SQLite database file into a :class:`SchemaGraph`."""

    def inspect(self, params: SqliteConnectionParams, schemas: Sequence[str]) -> SchemaGraph:
        """Read objects, columns and foreign keys from the SQLite file.

        Args:
            params: How to open the file.
            schemas: Ignored — SQLite has one namespace (``main``), always loaded. Accepted
                to match the :class:`~shirube.ports.repositories.SchemaInspector` port.

        Returns:
            The schema as a graph of objects and foreign-key relationships.

        Raises:
            ConnectionFailedError: if the file cannot be opened or read.
        """
        with read_only_connection(params) as connection:
            object_rows = [
                {"name": name, "type": type_}
                for name, type_ in connection.execute(_OBJECTS_SQL).fetchall()
            ]
            column_rows: list[dict[str, Any]] = []
            foreign_key_rows: list[dict[str, Any]] = []
            for obj in object_rows:
                name = obj["name"]
                for col in connection.execute(_COLUMNS_SQL, (name,)).fetchall():
                    column_rows.append(
                        {
                            "table": name,
                            "name": col[0],
                            "data_type": col[1],
                            "not_null": col[2],
                            "pk": col[3],
                        }
                    )
                if obj["type"] != "table":
                    continue  # Views have no foreign keys of their own.
                for fk in connection.execute(_FOREIGN_KEYS_SQL, (name,)).fetchall():
                    foreign_key_rows.append(
                        {
                            "source_table": name,
                            "id": fk[0],
                            "target_table": fk[2],
                            "from_column": fk[3],
                            "to_column": fk[4],
                        }
                    )
        return build_graph(object_rows, column_rows, foreign_key_rows)
