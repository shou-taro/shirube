"""Fixtures for the integration tests — the ones that need a real PostgreSQL.

These prove what a fake cursor never could: that the SQL shirube emits behaves correctly
against a live server, and that its safety guarantees actually hold. They run only when
``SHIRUBE_TEST_DATABASE_URL`` points at a reachable database (a throwaway one — the
fixtures create and drop their own schemas); otherwise every test here skips, so a
machine or CI job without a database stays green.

The admin connection needs enough privilege to ``CREATE``/``DROP`` a schema. The code
under test opens its *own* read-only connection, so the admin role being privileged is
the point: it proves shirube refuses writes even when the role could make them.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

import psycopg
import pytest

from shirube.domain.connection import ConnectionParams, SslMode

_ENV_VAR = "SHIRUBE_TEST_DATABASE_URL"


def _params_from_url(url: str) -> ConnectionParams:
    """Turn a ``postgresql://`` URL into shirube's own connection parameters.

    SSL is disabled: the target is a local, throwaway test database, so certificate
    negotiation only gets in the way.
    """
    parsed = urlparse(url)
    return ConnectionParams(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 5432,
        database=(parsed.path.lstrip("/") or "postgres"),
        username=unquote(parsed.username or "postgres"),
        password=unquote(parsed.password or ""),
        sslmode=SslMode.DISABLE,
    )


@pytest.fixture(scope="session")
def database_url() -> str:
    """The test database URL, or skip the whole integration suite if it is unset."""
    url = os.environ.get(_ENV_VAR)
    if not url:
        pytest.skip(f"{_ENV_VAR} is not set; skipping integration tests")
    return url


@pytest.fixture
def admin_connection(database_url: str) -> Iterator[psycopg.Connection]:
    """A privileged, autocommit connection used only to build and tear down fixtures."""
    with psycopg.connect(database_url, autocommit=True) as connection:
        yield connection


@pytest.fixture
def params(database_url: str) -> ConnectionParams:
    """The connection parameters the code under test opens its own connection with."""
    return _params_from_url(database_url)


@pytest.fixture
def make_schema(admin_connection: psycopg.Connection) -> Iterator[Callable[[], str]]:
    """A factory that creates uniquely named throwaway schemas and drops them afterwards.

    Returns fresh schema names on demand (a test may want one or two — e.g. to check a
    cross-schema foreign key), all dropped with CASCADE at teardown.
    """
    names: list[str] = []

    def _make() -> str:
        name = f"shirube_it_{uuid.uuid4().hex}"
        admin_connection.execute(f'CREATE SCHEMA "{name}"')
        names.append(name)
        return name

    yield _make
    for name in names:
        admin_connection.execute(f'DROP SCHEMA "{name}" CASCADE')


@dataclass(frozen=True)
class SampleObject:
    """A throwaway schema and table with known rows, for asserting exact results."""

    params: ConnectionParams
    schema: str
    table: str
    columns: tuple[str, ...]


@pytest.fixture
def sample_object(
    admin_connection: psycopg.Connection,
    database_url: str,
) -> Iterator[SampleObject]:
    """Create a uniquely named schema with a small, known ``users`` table, then drop it.

    Deterministic rows mean tests can assert exact values, counts and ordering without
    depending on anything else in the database.
    """
    schema = f"shirube_it_{uuid.uuid4().hex}"
    admin_connection.execute(f'CREATE SCHEMA "{schema}"')
    admin_connection.execute(
        f'CREATE TABLE "{schema}".users (id integer PRIMARY KEY, email text, note text)'
    )
    admin_connection.execute(
        f'INSERT INTO "{schema}".users (id, email, note) VALUES '
        "(1, 'alice@acme.example', 'first'),"
        "(2, 'bob@acme.example', NULL),"
        "(3, 'carol@other.example', 'third')"
    )
    try:
        yield SampleObject(
            params=_params_from_url(database_url),
            schema=schema,
            table="users",
            columns=("id", "email", "note"),
        )
    finally:
        admin_connection.execute(f'DROP SCHEMA "{schema}" CASCADE')


@dataclass(frozen=True)
class HostileObject:
    """A table whose name and columns need quoting — including SQL metacharacters."""

    params: ConnectionParams
    schema: str
    table: str
    weird_column: str


@pytest.fixture
def hostile_object(
    admin_connection: psycopg.Connection,
    database_url: str,
) -> Iterator[HostileObject]:
    """Create a table with quoting-hostile identifiers, then drop it.

    The table name embeds a double quote; one column is a reserved word, one contains a
    space, and one *is* an injection attempt (``"; DROP TABLE x; --``). If shirube quotes
    identifiers correctly, reading and filtering these works and nothing is destroyed.
    """
    schema = f"shirube_it_{uuid.uuid4().hex}"
    # A literal double quote in an identifier is written as two double quotes.
    table = 'we"ird'
    weird_column = "; DROP TABLE x; --"
    admin_connection.execute(f'CREATE SCHEMA "{schema}"')
    admin_connection.execute(
        f'CREATE TABLE "{schema}"."we""ird" ('
        "  id integer PRIMARY KEY,"
        '  "select" text,'
        '  "a b" text,'
        '  "; DROP TABLE x; --" text'
        ")"
    )
    admin_connection.execute(
        f'INSERT INTO "{schema}"."we""ird" (id, "select", "a b", "; DROP TABLE x; --") '
        "VALUES (1, 'reserved', 'spaced', 'hit'), (2, 'other', 'value', 'miss')"
    )
    try:
        yield HostileObject(
            params=_params_from_url(database_url),
            schema=schema,
            table=table,
            weird_column=weird_column,
        )
    finally:
        admin_connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
