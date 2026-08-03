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
    order_key: Sequence[str] = (),
    rowid_fallback: bool = False,
) -> tuple[str, list[Any]]:
    """Assemble a safe ``SELECT`` for a page of an object's rows.

    Identifiers (the table and any filtered or sorted columns) are quoted, and every value is
    bound as a parameter, so nothing the caller supplies is ever interpolated into SQL text.
    Filters compare the column *as text* (``CAST(col AS TEXT)``) so one small set of operators
    works on any column type — fine for a preview. One extra row beyond the limit is requested
    so the caller can tell whether a further page exists.

    A deterministic ``ORDER BY`` is emitted when a stable key exists: the requested sort first
    (if any), then the primary key (``order_key``) as a tiebreaker, or — for a keyless rowid
    table — the implicit ``rowid``. Without it, ``LIMIT``/``OFFSET`` could repeat or skip rows
    between pages, since SQLite does not otherwise guarantee row order.

    Args:
        name: The object's name.
        columns: The object's real column names, used to validate the query.
        query: The page to read — limit, offset, sort and filters.
        order_key: The primary-key columns in key order, appended as a tiebreaker. Empty for a
            keyless table or a view.
        rowid_fallback: When ``order_key`` is empty, whether the object is a rowid table whose
            implicit ``rowid`` gives a stable order (false for a view or a WITHOUT ROWID table,
            which always has a primary key instead).

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

    order_terms: list[str] = []
    sort_column: str | None = None
    if query.sort is not None:
        if query.sort.column not in known:
            raise InvalidQueryError(f"Unknown column '{query.sort.column}'")
        direction = "ASC" if query.sort.direction is SortDirection.ASC else "DESC"
        order_terms.append(f"{_quote(query.sort.column)} {direction}")
        sort_column = query.sort.column
    # The primary key breaks ties and orders an unsorted page; skip a key column already sorted.
    for key_column in order_key:
        if key_column != sort_column:
            order_terms.append(f"{_quote(key_column)} ASC")
    # No primary key, but a rowid table has a stable implicit key. ``rowid`` is written bare and
    # never quoted: a quoted "rowid" with no such column is read by SQLite as a string literal,
    # which would silently order by a constant (i.e. not at all).
    if not order_key and rowid_fallback:
        order_terms.append("rowid ASC")
    if order_terms:
        statement += " ORDER BY " + ", ".join(order_terms)

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
            # Prove the object is a real table or view before trusting its name; the type also
            # tells whether an implicit rowid is available for stable ordering.
            row = connection.execute(
                "SELECT type FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
                (name,),
            ).fetchone()
            if row is None:
                raise ObjectNotFoundError(f"'{object_id}' is not a table or view here")
            is_table = row[0] == "table"

            # Read the columns to validate the query, and the primary key (``pk`` > 0, in key
            # order) to page stably. A rowid table with no declared key falls back to rowid.
            info = connection.execute(
                "SELECT name, pk FROM pragma_table_info(?)", (name,)
            ).fetchall()
            columns = [info_row[0] for info_row in info]
            order_key = [name for _pk, name in sorted((r[1], r[0]) for r in info if r[1] > 0)]

            statement, statement_params = build_select(
                name, columns, query, order_key, rowid_fallback=is_table
            )
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
