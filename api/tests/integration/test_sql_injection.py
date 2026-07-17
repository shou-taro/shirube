"""SQL-injection resistance and identifier quoting, proven against a real PostgreSQL.

The row reader takes three kinds of caller-controlled input — the object id, column
names in filters and sorts, and filter *values*. This suite throws hostile strings at
all three and proves the outcome is always safe: values are bound as parameters, unknown
columns are rejected by the whitelist, an unknown object is a clean not-found, and even
identifiers full of metacharacters read back correctly. After each attack the schema is
checked to still be intact.
"""

from __future__ import annotations

import psycopg
import pytest

from shirube.adapters.postgres.data_reader import PostgresDataReader
from shirube.domain.data import ColumnFilter, FilterOperator, RowQuery, SortDirection, SortOrder
from shirube.domain.errors import InvalidQueryError, ObjectNotFoundError

from .conftest import HostileObject, SampleObject

pytestmark = pytest.mark.integration

_INJECTION = 'x\'; DROP TABLE "{schema}".users; --'


def _table_exists(connection: psycopg.Connection, schema: str, table: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM pg_tables WHERE schemaname = %s AND tablename = %s",
        (schema, table),
    ).fetchone()
    return row is not None


def test_a_hostile_filter_value_is_bound_not_executed(
    sample_object: SampleObject,
    admin_connection: psycopg.Connection,
) -> None:
    """An injection payload in a filter value matches nothing and destroys nothing."""
    payload = _INJECTION.format(schema=sample_object.schema)
    page = PostgresDataReader().read_rows(
        sample_object.params,
        [sample_object.schema],
        f"{sample_object.schema}.users",
        RowQuery(limit=100, offset=0, filters=(ColumnFilter("email", FilterOperator.EQ, payload),)),
    )

    # Bound as a parameter: no row has that literal email, and the table is untouched.
    assert page.rows == ()
    assert _table_exists(admin_connection, sample_object.schema, "users")


def test_a_hostile_filter_column_is_rejected_by_the_whitelist(
    sample_object: SampleObject,
    admin_connection: psycopg.Connection,
) -> None:
    payload = 'id"; DROP TABLE users; --'
    with pytest.raises(InvalidQueryError):
        PostgresDataReader().read_rows(
            sample_object.params,
            [sample_object.schema],
            f"{sample_object.schema}.users",
            RowQuery(limit=100, offset=0, filters=(ColumnFilter(payload, FilterOperator.EQ, "1"),)),
        )

    assert _table_exists(admin_connection, sample_object.schema, "users")


def test_a_hostile_sort_column_is_rejected_by_the_whitelist(
    sample_object: SampleObject,
    admin_connection: psycopg.Connection,
) -> None:
    payload = 'id"; DROP TABLE users; --'
    with pytest.raises(InvalidQueryError):
        PostgresDataReader().read_rows(
            sample_object.params,
            [sample_object.schema],
            f"{sample_object.schema}.users",
            RowQuery(limit=100, offset=0, sort=SortOrder(payload, SortDirection.ASC)),
        )

    assert _table_exists(admin_connection, sample_object.schema, "users")


def test_a_hostile_object_id_is_a_clean_not_found(
    sample_object: SampleObject,
    admin_connection: psycopg.Connection,
) -> None:
    payload = f'{sample_object.schema}.users\'; DROP TABLE "{sample_object.schema}".users; --'
    with pytest.raises(ObjectNotFoundError):
        PostgresDataReader().read_rows(
            sample_object.params,
            [sample_object.schema],
            payload,
            RowQuery(limit=100, offset=0),
        )

    assert _table_exists(admin_connection, sample_object.schema, "users")


def test_quoting_hostile_identifiers_read_back_correctly(hostile_object: HostileObject) -> None:
    """A table and columns full of metacharacters are read without error or injection."""
    page = PostgresDataReader().read_rows(
        hostile_object.params,
        [hostile_object.schema],
        f"{hostile_object.schema}.{hostile_object.table}",
        RowQuery(limit=100, offset=0),
    )

    assert page.columns == ("id", "select", "a b", "; DROP TABLE x; --")
    assert len(page.rows) == 2


def test_filtering_on_a_hostile_column_name_is_safe(hostile_object: HostileObject) -> None:
    """A filter that names the injection-shaped column is quoted and returns the right row."""
    page = PostgresDataReader().read_rows(
        hostile_object.params,
        [hostile_object.schema],
        f"{hostile_object.schema}.{hostile_object.table}",
        RowQuery(
            limit=100,
            offset=0,
            filters=(ColumnFilter(hostile_object.weird_column, FilterOperator.EQ, "hit"),),
        ),
    )

    # Only the first row has 'hit' in that column.
    assert len(page.rows) == 1
    assert page.rows[0][0] == 1
