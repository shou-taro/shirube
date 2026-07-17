"""Read-only enforcement, proven against a real PostgreSQL.

Read-only is shirube's headline safety promise, so it gets an adversarial test rather
than a hopeful one: connect as a *privileged* role and prove that writes are refused and
a slow query is aborted anyway. Because the guarantee lives in
:func:`read_only_connection`, the role being able to write is exactly what makes the
test meaningful.
"""

from __future__ import annotations

import psycopg
import pytest

from shirube.adapters.postgres import _common
from shirube.adapters.postgres._common import read_only_connection
from shirube.domain.errors import ConnectionFailedError

from .conftest import SampleObject

pytestmark = pytest.mark.integration


def test_the_connection_is_read_only(sample_object: SampleObject) -> None:
    with read_only_connection(sample_object.params) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SHOW transaction_read_only")
            assert cursor.fetchone()[0] == "on"  # type: ignore[index]


@pytest.mark.parametrize(
    "write",
    [
        'INSERT INTO "{schema}".users (id) VALUES (99)',
        "UPDATE \"{schema}\".users SET email = 'x' WHERE id = 1",
        'DELETE FROM "{schema}".users WHERE id = 1',
        'CREATE TABLE "{schema}".sneaky (x integer)',
        'DROP TABLE "{schema}".users',
    ],
)
def test_writes_are_refused(sample_object: SampleObject, write: str) -> None:
    """Every kind of write is rejected as a read-only-transaction error, not run.

    The driver error surfaces translated as ``ConnectionFailedError``; its cause carries
    SQLSTATE ``25006`` (``read_only_sql_transaction``), which is the proof the refusal is
    the read-only guard and not some unrelated failure.
    """
    statement = write.format(schema=sample_object.schema)
    with pytest.raises(ConnectionFailedError) as exc_info:
        with read_only_connection(sample_object.params) as connection:
            with connection.cursor() as cursor:
                cursor.execute(statement)

    cause = exc_info.value.__cause__
    assert isinstance(cause, psycopg.Error)
    assert cause.sqlstate == "25006"


def test_the_table_survives_a_refused_write(sample_object: SampleObject) -> None:
    """A refused write leaves the data untouched — nothing partially applied."""
    with pytest.raises(ConnectionFailedError):
        with read_only_connection(sample_object.params) as connection:
            with connection.cursor() as cursor:
                cursor.execute(f'DELETE FROM "{sample_object.schema}".users')

    # A fresh read-only connection still sees all three rows.
    with read_only_connection(sample_object.params) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f'SELECT count(*) FROM "{sample_object.schema}".users')
            assert cursor.fetchone()[0] == 3  # type: ignore[index]


def test_statement_timeout_is_applied(sample_object: SampleObject) -> None:
    with read_only_connection(sample_object.params) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SHOW statement_timeout")
            assert cursor.fetchone()[0] == "5s"  # type: ignore[index]


def test_a_slow_query_is_aborted(
    sample_object: SampleObject,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The statement timeout actually fires — a query past it is cancelled.

    The production timeout is shortened for the test so it need not wait five seconds;
    what is being proven is that the timeout is in force and aborts the query, surfacing
    as SQLSTATE ``57014`` (``query_canceled``).
    """
    monkeypatch.setattr(_common, "STATEMENT_TIMEOUT_MS", 250)
    with pytest.raises(ConnectionFailedError) as exc_info:
        with read_only_connection(sample_object.params) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_sleep(3)")

    cause = exc_info.value.__cause__
    assert isinstance(cause, psycopg.Error)
    assert cause.sqlstate == "57014"
