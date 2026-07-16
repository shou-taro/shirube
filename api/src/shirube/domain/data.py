"""Domain types for previewing an object's rows.

Where :mod:`shirube.domain.schema` describes a database's *structure*, these describe a
read-only request for its *contents* — a page of rows from a single table or view, with
optional filtering and sorting — and the page that comes back. They are plain data,
independent of how the rows are read (PostgreSQL today) or rendered.
"""

from dataclasses import dataclass, field
from enum import StrEnum

# A single cell's value, already reduced to something JSON can carry. The reader converts
# every driver value to one of these (exotic types fall back to their text form), so the
# API and frontend never have to know about database-specific Python types.
CellValue = str | int | float | bool | None


class FilterOperator(StrEnum):
    """How a filter compares a column against a value.

    A deliberately small, type-agnostic set: the reader casts the column to text before
    comparing, so the same operators work on any column without the caller choosing a
    per-type variant. ``IS_NULL`` and ``IS_NOT_NULL`` ignore the filter's value.
    """

    EQ = "eq"
    NE = "ne"
    CONTAINS = "contains"
    IS_NULL = "is_null"
    IS_NOT_NULL = "is_not_null"


class SortDirection(StrEnum):
    """Ascending or descending order for a sorted column."""

    ASC = "asc"
    DESC = "desc"


@dataclass(frozen=True, slots=True)
class ColumnFilter:
    """One filter condition — ``column operator value`` — combined with others by AND.

    Attributes:
        column: The column to test; validated against the object's real columns.
        operator: How to compare (see :class:`FilterOperator`).
        value: The value to compare against; unused for the null checks, and treated as
            an empty string when omitted for the others.
    """

    column: str
    operator: FilterOperator
    value: str | None = None


@dataclass(frozen=True, slots=True)
class SortOrder:
    """A sort: which column, and in which direction."""

    column: str
    direction: SortDirection = SortDirection.ASC


@dataclass(frozen=True, slots=True)
class RowQuery:
    """A read-only request for a page of an object's rows.

    Attributes:
        limit: The most rows to return.
        offset: How many rows to skip — the page's starting position.
        sort: How to order the rows, or ``None`` for the database's own order.
        filters: Conditions to narrow the rows, combined by AND (empty means all rows).
    """

    limit: int
    offset: int
    sort: SortOrder | None = None
    filters: tuple[ColumnFilter, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class RowPage:
    """One page of rows read back from an object.

    Attributes:
        columns: The column names, in the order the cells appear in each row.
        rows: The rows, each a tuple of cell values aligned to ``columns``.
        has_more: Whether at least one further row exists past this page — so the UI can
            offer a "next page" without counting the whole (possibly huge) table.
        offset: The offset this page was read at (echoed back for the UI).
        limit: The limit this page was read with (echoed back for the UI).
    """

    columns: tuple[str, ...]
    rows: tuple[tuple[CellValue, ...], ...]
    has_more: bool
    offset: int
    limit: int
