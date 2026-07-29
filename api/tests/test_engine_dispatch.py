"""Tests that each engine dispatcher routes to the adapter matching the parameters' type.

The dispatchers are the per-request factory that replaces the single AI provider's start-up
factory: given a profile's parameters, they must hand the call to the PostgreSQL adapter for
server parameters and the SQLite adapter for a file. These use recording fakes so the routing
itself is asserted, not the adapters behind it.
"""

import pytest

from shirube.adapters.engine_dispatch import (
    DispatchingDatabaseConnector,
    DispatchingDataReader,
    DispatchingSchemaInspector,
)
from shirube.domain.connection import (
    ConnectionParams,
    PostgresConnectionParams,
    SqliteConnectionParams,
    SslMode,
)
from shirube.domain.data import RowQuery

_PG = PostgresConnectionParams(
    host="db.example.com",
    port=5432,
    database="shop",
    username="readonly",
    password="",
    sslmode=SslMode.PREFER,
)
_SQLITE = SqliteConnectionParams(path="/data/sample.sqlite")


class _Recorder:
    """Records the parameters it was called with and returns a labelled sentinel."""

    def __init__(self, label: str) -> None:
        self.label = label
        self.calls: list[ConnectionParams] = []

    def inspect(self, params: ConnectionParams, schemas: object) -> str:
        self.calls.append(params)
        return self.label

    def read_rows(
        self,
        params: ConnectionParams,
        schemas: object,
        object_id: object,
        query: object,
    ) -> str:
        self.calls.append(params)
        return self.label

    def test_connection(self, params: ConnectionParams) -> None:
        self.calls.append(params)


@pytest.mark.parametrize(
    ("params", "expected"),
    [(_PG, "postgres"), (_SQLITE, "sqlite")],
)
def test_schema_inspector_routes_by_parameter_type(
    params: ConnectionParams,
    expected: str,
) -> None:
    postgres, sqlite = _Recorder("postgres"), _Recorder("sqlite")
    dispatcher = DispatchingSchemaInspector(postgres, sqlite)  # type: ignore[arg-type]

    dispatcher.inspect(params, schemas=())

    # Only the matching adapter is called; the other is left untouched.
    chosen, other = (sqlite, postgres) if expected == "sqlite" else (postgres, sqlite)
    assert chosen.calls == [params]
    assert other.calls == []


@pytest.mark.parametrize(
    ("params", "expected"),
    [(_PG, "postgres"), (_SQLITE, "sqlite")],
)
def test_data_reader_routes_by_parameter_type(
    params: ConnectionParams,
    expected: str,
) -> None:
    postgres, sqlite = _Recorder("postgres"), _Recorder("sqlite")
    dispatcher = DispatchingDataReader(postgres, sqlite)  # type: ignore[arg-type]

    dispatcher.read_rows(
        params,
        schemas=(),
        object_id="main.thing",
        query=RowQuery(limit=10, offset=0),
    )

    chosen, other = (sqlite, postgres) if expected == "sqlite" else (postgres, sqlite)
    assert chosen.calls == [params]
    assert other.calls == []


@pytest.mark.parametrize(
    ("params", "expected"),
    [(_PG, "postgres"), (_SQLITE, "sqlite")],
)
def test_connector_routes_by_parameter_type(
    params: ConnectionParams,
    expected: str,
) -> None:
    postgres, sqlite = _Recorder("postgres"), _Recorder("sqlite")
    dispatcher = DispatchingDatabaseConnector(postgres, sqlite)  # type: ignore[arg-type]

    dispatcher.test_connection(params)

    chosen, other = (sqlite, postgres) if expected == "sqlite" else (postgres, sqlite)
    assert chosen.calls == [params]
    assert other.calls == []
