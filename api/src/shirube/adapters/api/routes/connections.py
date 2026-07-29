"""Endpoints for testing database connections."""

from collections.abc import Callable
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from shirube.adapters.api.dependencies import get_connection_service, get_file_picker
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


class PickedFile(BaseModel):
    """The file a user chose in the native dialog, or ``null`` if they cancelled."""

    path: str | None = None


ServiceDep = Annotated[ConnectionService, Depends(get_connection_service)]
FilePickerDep = Annotated[Callable[[], str | None], Depends(get_file_picker)]


@router.post("/test", response_model=ConnectionTestResult)
def test_connection(body: ConnectionTestRequest, service: ServiceDep) -> ConnectionTestResult:
    """Test a set of connection parameters.

    Returns ``{"ok": true}`` on success; a failure surfaces as a 400 with a translated,
    actionable message.
    """
    service.test(body.to_params())
    return ConnectionTestResult()


@router.post("/pick-file", response_model=PickedFile)
def pick_file(picker: FilePickerDep) -> PickedFile:
    """Open a native file-open dialog to choose a SQLite database file.

    The dialog is shown by the local server (a browser cannot reveal a file's real path), so
    the connection form can offer a "Browse…" button. Returns the chosen absolute path, or
    ``null`` when the user cancels; if no dialog can be shown (a headless session, or a Python
    without Tk) the request fails with 503 and the form keeps its text field.
    """
    return PickedFile(path=picker())
