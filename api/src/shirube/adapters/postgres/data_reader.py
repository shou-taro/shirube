"""PostgreSQL row-preview adapter.

Reads a page of rows from one table or view under shirube's read-only guarantee. The
query is assembled with :mod:`psycopg.sql` so identifiers are quoted and every value is
bound as a parameter — the object and its columns are resolved from the catalogues
first, so a column named in a filter or sort is checked against what really exists
before any SQL touches the database. Splitting :func:`build_select` out keeps that
assembly pure and testable without a live connection.
"""

from collections.abc import Sequence
from typing import Any

from psycopg import sql

from shirube.adapters.postgres._common import read_only_connection
from shirube.domain.connection import ConnectionParams
from shirube.domain.data import (
    CellValue,
    FilterOperator,
    RowPage,
    RowQuery,
    SortDirection,
)
from shirube.domain.errors import InvalidQueryError, ObjectNotFoundError


def _schema_filter(alias: str) -> str:
    """A WHERE fragment restricting a namespace to the requested (non-system) schemas.

    Mirrors the schema inspector's own guard so a preview can only ever reach the same
    user schemas the map shows. ``%%`` escapes the literal ``%`` for psycopg's parameter
    substitution; an empty ``schemas`` array means "all non-system schemas".
    """
    return (
        f"{alias}.nspname NOT IN ('pg_catalog', 'information_schema') "
        f"AND {alias}.nspname NOT LIKE 'pg_%%' "
        f"AND (cardinality(%(schemas)s::text[]) = 0 "
        f"OR {alias}.nspname = ANY(%(schemas)s::text[]))"
    )


# Resolve an object id to its real schema, name and column list in one go. The rows also
# prove the object exists in an allowed schema (no rows → not found), and give the column
# whitelist used to validate the query. Ordered by column position so the whitelist keeps
# the table's natural order.
_RESOLVE_OBJECT_SQL = f"""
    SELECT n.nspname AS schema, c.relname AS name, a.attname AS column
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'v', 'm', 'p')
      AND a.attnum > 0 AND NOT a.attisdropped
      AND n.nspname || '.' || c.relname = %(object_id)s
      AND {_schema_filter("n")}
    ORDER BY a.attnum
"""  # nosec B608


def build_select(
    schema: str,
    name: str,
    columns: Sequence[str],
    query: RowQuery,
) -> tuple[sql.Composed, list[Any]]:
    """Assemble a safe ``SELECT`` for a page of an object's rows.

    Identifiers (the table and any filtered or sorted columns) are quoted, and every
    value is bound as a parameter, so nothing the caller supplies is ever interpolated
    into SQL text. Filters compare the column *as text* (``col::text``) so one small set
    of operators works on any column type — fine for a preview, where index use does not
    matter. One extra row beyond the limit is requested so the caller can tell whether a
    further page exists.

    Args:
        schema: The object's schema (namespace).
        name: The object's name.
        columns: The object's real column names, used to validate the query.
        query: The page to read — limit, offset, sort and filters.

    Returns:
        The composed statement and the ordered list of parameters to run it with.

    Raises:
        InvalidQueryError: if a filter or sort names a column the object lacks.
    """
    known = set(columns)
    conditions: list[sql.Composed] = []
    params: list[Any] = []
    for condition in query.filters:
        if condition.column not in known:
            raise InvalidQueryError(f"Unknown column '{condition.column}'")
        column = sql.Identifier(condition.column)
        match condition.operator:
            case FilterOperator.IS_NULL:
                conditions.append(sql.SQL("{} IS NULL").format(column))
            case FilterOperator.IS_NOT_NULL:
                conditions.append(sql.SQL("{} IS NOT NULL").format(column))
            case FilterOperator.EQ:
                conditions.append(sql.SQL("{}::text = {}").format(column, sql.Placeholder()))
                params.append(condition.value or "")
            case FilterOperator.NE:
                conditions.append(sql.SQL("{}::text <> {}").format(column, sql.Placeholder()))
                params.append(condition.value or "")
            case FilterOperator.CONTAINS:
                conditions.append(sql.SQL("{}::text ILIKE {}").format(column, sql.Placeholder()))
                params.append(f"%{condition.value or ''}%")

    statement = sql.SQL("SELECT * FROM {}.{}").format(
        sql.Identifier(schema),
        sql.Identifier(name),
    )
    if conditions:
        statement += sql.SQL(" WHERE ") + sql.SQL(" AND ").join(conditions)
    if query.sort is not None:
        if query.sort.column not in known:
            raise InvalidQueryError(f"Unknown column '{query.sort.column}'")
        direction = sql.SQL("ASC") if query.sort.direction is SortDirection.ASC else sql.SQL("DESC")
        statement += sql.SQL(" ORDER BY {} ").format(sql.Identifier(query.sort.column)) + direction
    statement += sql.SQL(" LIMIT {} OFFSET {}").format(sql.Placeholder(), sql.Placeholder())
    # Ask for one more than the limit; its presence is how has_more is decided.
    params.append(query.limit + 1)
    params.append(query.offset)
    return statement, params


def _cell(value: object) -> CellValue:
    """Reduce a driver value to something JSON can carry.

    Primitives pass straight through (``bool`` included — it serialises as ``true`` /
    ``false``); binary is shown as a size placeholder rather than an unreadable blob; and
    everything else — dates, decimals, UUIDs, arrays, JSON — falls back to its text form,
    which is what a preview wants to display anyway.
    """
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"[{len(bytes(value))} bytes]"
    return str(value)


class PostgresDataReader:
    """Reads a page of rows from a PostgreSQL table or view, read-only."""

    def read_rows(
        self,
        params: ConnectionParams,
        schemas: Sequence[str],
        object_id: str,
        query: RowQuery,
    ) -> RowPage:
        """Read a filtered, sorted page of an object's rows.

        Resolves the object and its columns from the catalogues (which also confirms it
        exists in an allowed schema), validates the query against those columns, then
        runs the assembled ``SELECT`` on the same read-only connection.

        Args:
            params: How to connect.
            schemas: Schemas the object may live in; empty means all non-system schemas.
            object_id: The ``schema.name`` id of the table or view to read.
            query: The page to read.

        Returns:
            The requested page of rows.

        Raises:
            ObjectNotFoundError: if no such object exists in the allowed schemas.
            InvalidQueryError: if the query names a column the object does not have.
            ConnectionFailedError: if the database cannot be reached or read.
        """
        resolve_params = {"object_id": object_id, "schemas": list(schemas)}
        with read_only_connection(params) as connection:
            with connection.cursor() as cursor:
                cursor.execute(_RESOLVE_OBJECT_SQL, resolve_params)
                meta = cursor.fetchall()
                if not meta:
                    raise ObjectNotFoundError(f"'{object_id}' is not a table or view here")
                schema, name = meta[0][0], meta[0][1]
                columns = [row[2] for row in meta]

                statement, statement_params = build_select(schema, name, columns, query)
                cursor.execute(statement, statement_params)
                fetched = cursor.fetchall()
                # SELECT * fixes the display order and names (dropped/system columns are
                # already excluded), so read them straight off the cursor. A SELECT always
                # populates ``description``; the ``or ()`` only quiets its Optional typing.
                result_columns = tuple(column.name for column in cursor.description or ())

        has_more = len(fetched) > query.limit
        page_rows = tuple(tuple(_cell(value) for value in row) for row in fetched[: query.limit])
        return RowPage(
            columns=result_columns,
            rows=page_rows,
            has_more=has_more,
            offset=query.offset,
            limit=query.limit,
        )
