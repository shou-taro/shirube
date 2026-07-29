"""Route each database port to the engine that matches the connection parameters.

The connection ports (:class:`~shirube.ports.repositories.SchemaInspector`,
:class:`~shirube.ports.repositories.DataReader`,
:class:`~shirube.ports.repositories.DatabaseConnector`) each have one adapter per engine.
Which engine a request uses is decided per profile, at request time — not when dependencies
are wired — so the choice cannot live in a start-up factory the way the single AI provider's
does. These dispatchers stand in for that per-request factory: each implements a port and,
on every call, sends the request to the adapter matching the parameters' type. Services keep
depending on the plain port, unaware there is more than one engine.

They compose the concrete adapters directly — this is the wiring layer, the database
counterpart to :mod:`shirube.adapters.ai.factory` — and narrow the parameter union so each
engine adapter is only ever handed the parameter type it accepts.
"""

from collections.abc import Sequence

from shirube.adapters.postgres.connector import PostgresConnector
from shirube.adapters.postgres.data_reader import PostgresDataReader
from shirube.adapters.postgres.schema_inspector import PostgresSchemaInspector
from shirube.adapters.sqlite.connector import SqliteConnector
from shirube.adapters.sqlite.data_reader import SqliteDataReader
from shirube.adapters.sqlite.schema_inspector import SqliteSchemaInspector
from shirube.domain.connection import ConnectionParams, SqliteConnectionParams
from shirube.domain.data import RowPage, RowQuery
from shirube.domain.schema import SchemaGraph


class DispatchingSchemaInspector:
    """A :class:`SchemaInspector` that routes to the engine adapter for the given parameters."""

    def __init__(self, postgres: PostgresSchemaInspector, sqlite: SqliteSchemaInspector) -> None:
        self._postgres = postgres
        self._sqlite = sqlite

    def inspect(self, params: ConnectionParams, schemas: Sequence[str]) -> SchemaGraph:
        """Introspect using the adapter that matches ``params``'s engine."""
        if isinstance(params, SqliteConnectionParams):
            return self._sqlite.inspect(params, schemas)
        return self._postgres.inspect(params, schemas)


class DispatchingDataReader:
    """A :class:`DataReader` that routes to the engine adapter for the given parameters."""

    def __init__(self, postgres: PostgresDataReader, sqlite: SqliteDataReader) -> None:
        self._postgres = postgres
        self._sqlite = sqlite

    def read_rows(
        self,
        params: ConnectionParams,
        schemas: Sequence[str],
        object_id: str,
        query: RowQuery,
    ) -> RowPage:
        """Read rows using the adapter that matches ``params``'s engine."""
        if isinstance(params, SqliteConnectionParams):
            return self._sqlite.read_rows(params, schemas, object_id, query)
        return self._postgres.read_rows(params, schemas, object_id, query)


class DispatchingDatabaseConnector:
    """A :class:`DatabaseConnector` that routes to the engine adapter for the given parameters."""

    def __init__(self, postgres: PostgresConnector, sqlite: SqliteConnector) -> None:
        self._postgres = postgres
        self._sqlite = sqlite

    def test_connection(self, params: ConnectionParams) -> None:
        """Test the connection using the adapter that matches ``params``'s engine."""
        if isinstance(params, SqliteConnectionParams):
            self._sqlite.test_connection(params)
        else:
            self._postgres.test_connection(params)
