"""Endpoints for testing database connections."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from shirube.adapters.api.dependencies import get_connection_service
from shirube.application.connections import ConnectionService
from shirube.domain.connection import (
    ConnectionParams,
    DatabaseKind,
    PostgresConnectionParams,
    SqliteConnectionParams,
    SslMode,
)

router = APIRouter(prefix="/connections", tags=["connections"])


class PostgresConnectionTest(BaseModel):
    """Ad-hoc PostgreSQL connection parameters to test (e.g. from the connection form)."""

    kind: Literal[DatabaseKind.POSTGRESQL] = DatabaseKind.POSTGRESQL
    host: str
    port: int = 5432
    database: str
    username: str
    password: str
    sslmode: SslMode = SslMode.PREFER

    def to_params(self) -> ConnectionParams:
        """Build the domain connection parameters."""
        return PostgresConnectionParams(
            host=self.host,
            port=self.port,
            database=self.database,
            username=self.username,
            password=self.password,
            sslmode=self.sslmode,
        )


class SqliteConnectionTest(BaseModel):
    """Ad-hoc SQLite connection parameters to test — just the file path."""

    kind: Literal[DatabaseKind.SQLITE]
    path: str

    def to_params(self) -> ConnectionParams:
        """Build the domain connection parameters."""
        return SqliteConnectionParams(path=self.path)


# The request body is one of the per-engine shapes, told apart by the ``kind`` discriminator.
ConnectionTestRequest = Annotated[
    PostgresConnectionTest | SqliteConnectionTest,
    Field(discriminator="kind"),
]


class ConnectionTestResult(BaseModel):
    """The result of a successful connection test."""

    ok: bool = True


ServiceDep = Annotated[ConnectionService, Depends(get_connection_service)]


@router.post("/test", response_model=ConnectionTestResult)
def test_connection(body: ConnectionTestRequest, service: ServiceDep) -> ConnectionTestResult:
    """Test a set of connection parameters.

    Returns ``{"ok": true}`` on success; a failure surfaces as a 400 with a translated,
    actionable message.
    """
    service.test(body.to_params())
    return ConnectionTestResult()
