"""SQLite row-preview adapter.

Reads a page of rows from one table or view under shirube's read-only guarantee. The object
and its columns are resolved from the catalogue first, so a column named in a filter or sort
is checked against what really exists before any SQL is assembled; identifiers are then
quoted and every value is bound as a parameter. Splitting :func:`build_select` out keeps that
assembly pure and testable without a live connection.
"""

from collections.abc import Sequence
from typing import Any

from shirube.adapters.sqlite._common import read_only_connection
from shirube.adapters.sqlite.schema_inspector import SQLITE_SCHEMA
from shirube.domain.connection import SqliteConnectionParams
from shirube.domain.data import (
    CellValue,
    FilterOperator,
    RowPage,
    RowQuery,
    SortDirection,
)
from shirube.domain.errors import InvalidQueryError, ObjectNotFoundError


def _quote(identifier: str) -> str:
    """Quote a SQLite identifier, escaping any embedded double quote.

    Used for the table and column names, which come from the catalogue rather than the
    caller; quoting still guards names with spaces or reserved words.
    """
    escaped = identifier.replace('"', '""')
    return f'"{escaped}"'


def build_select(
    name: str,
    columns: Sequence[str],
    query: RowQuery,
) -> tuple[str, list[Any]]:
    """Assemble a safe ``SELECT`` for a page of an object's rows.

    Identifiers (the table and any filtered or sorted columns) are quoted, and every value is
    bound as a parameter, so nothing the caller supplies is ever interpolated into SQL text.
    Filters compare the column *as text* (``CAST(col AS TEXT)``) so one small set of operators
    works on any column type — fine for a preview. One extra row beyond the limit is requested
    so the caller can tell whether a further page exists.

    Args:
        name: The object's name.
        columns: The object's real column names, used to validate the query.
        query: The page to read — limit, offset, sort and filters.

    Returns:
        The SQL text and the ordered list of parameters to run it with.

    Raises:
        InvalidQueryError: if a filter or sort names a column the object lacks.
    """
    known = set(columns)
    conditions: list[str] = []
    params: list[Any] = []
    for condition in query.filters:
        if condition.column not in known:
            raise InvalidQueryError(f"Unknown column '{condition.column}'")
        column = _quote(condition.column)
        match condition.operator:
            case FilterOperator.IS_NULL:
                conditions.append(f"{column} IS NULL")
            case FilterOperator.IS_NOT_NULL:
                conditions.append(f"{column} IS NOT NULL")
            case FilterOperator.EQ:
                conditions.append(f"CAST({column} AS TEXT) = ?")
                params.append(condition.value or "")
            case FilterOperator.NE:
                conditions.append(f"CAST({column} AS TEXT) <> ?")
                params.append(condition.value or "")
            case FilterOperator.CONTAINS:
                # SQLite's LIKE is case-insensitive for ASCII, matching the ILIKE the
                # PostgreSQL reader uses for this operator.
                conditions.append(f"CAST({column} AS TEXT) LIKE ?")
                params.append(f"%{condition.value or ''}%")

    # The only identifiers interpolated are the table and columns, each run through _quote and
    # validated against the object's real columns above; every caller value is a bound ``?``
    # parameter. SQLite has no psycopg.sql-style composer, so the statement is built as text.
    statement = f"SELECT * FROM {_quote(name)}"  # nosec B608
    if conditions:
        statement += " WHERE " + " AND ".join(conditions)
    if query.sort is not None:
        if query.sort.column not in known:
            raise InvalidQueryError(f"Unknown column '{query.sort.column}'")
        direction = "ASC" if query.sort.direction is SortDirection.ASC else "DESC"
        statement += f" ORDER BY {_quote(query.sort.column)} {direction}"
    statement += " LIMIT ? OFFSET ?"
    # Ask for one more than the limit; its presence is how has_more is decided.
    params.append(query.limit + 1)
    params.append(query.offset)
    return statement, params


def _cell(value: object) -> CellValue:
    """Reduce a driver value to something JSON can carry.

    Primitives pass straight through; a BLOB is shown as a size placeholder rather than an
    unreadable blob; anything else falls back to its text form. (SQLite returns ``str``,
    ``int``, ``float``, ``bytes`` or ``None``, so the fallback rarely fires, but it keeps the
    reader safe against custom converters.)
    """
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"[{len(bytes(value))} bytes]"
    return str(value)


class SqliteDataReader:
    """Reads a page of rows from a SQLite table or view, read-only."""

    def read_rows(
        self,
        params: SqliteConnectionParams,
        schemas: Sequence[str],
        object_id: str,
        query: RowQuery,
    ) -> RowPage:
        """Read a filtered, sorted page of an object's rows.

        Resolves the object and its columns from the catalogue (which also confirms it
        exists), validates the query against those columns, then runs the assembled
        ``SELECT`` on the same read-only connection.

        Args:
            params: How to open the file.
            schemas: Ignored — SQLite has one namespace (``main``). Accepted to match the
                :class:`~shirube.ports.repositories.DataReader` port.
            object_id: The ``main.name`` id of the table or view to read.
            query: The page to read.

        Returns:
            The requested page of rows.

        Raises:
            ObjectNotFoundError: if no such table or view exists.
            InvalidQueryError: if the query names a column the object does not have.
            ConnectionFailedError: if the file cannot be opened or read.
        """
        schema, _, name = object_id.partition(".")
        if schema != SQLITE_SCHEMA or not name:
            raise ObjectNotFoundError(f"'{object_id}' is not a table or view here")

        with read_only_connection(params) as connection:
            # Prove the object is a real table or view before trusting its name, and read its
            # columns to validate the query against.
            exists = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
                (name,),
            ).fetchone()
            if exists is None:
                raise ObjectNotFoundError(f"'{object_id}' is not a table or view here")
            columns = [
                row[0]
                for row in connection.execute(
                    "SELECT name FROM pragma_table_info(?)", (name,)
                ).fetchall()
            ]

            statement, statement_params = build_select(name, columns, query)
            cursor = connection.execute(statement, statement_params)
            fetched = cursor.fetchall()
            # SELECT * fixes the display order and names; read them straight off the cursor.
            result_columns = tuple(description[0] for description in cursor.description or ())

        has_more = len(fetched) > query.limit
        page_rows = tuple(tuple(_cell(value) for value in row) for row in fetched[: query.limit])
        return RowPage(
            columns=result_columns,
            rows=page_rows,
            has_more=has_more,
            offset=query.offset,
            limit=query.limit,
        )
