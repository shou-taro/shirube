"""Endpoints for testing database connections."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from shirube.adapters.api.dependencies import get_connection_service
from shirube.application.connections import ConnectionService
from shirube.domain.connection import ConnectionParams, SslMode

router = APIRouter(prefix="/connections", tags=["connections"])


class ConnectionTestRequest(BaseModel):
    """Ad-hoc connection parameters to test (e.g. from the connection form)."""

    host: str
    port: int = 5432
    database: str
    username: str
    password: str
    sslmode: SslMode = SslMode.PREFER

    def to_params(self) -> ConnectionParams:
        """Build the domain connection parameters."""
        return ConnectionParams(
            host=self.host,
            port=self.port,
            database=self.database,
            username=self.username,
            password=self.password,
            sslmode=self.sslmode,
        )


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
