"""Connection-profile management endpoints.

Full CRUD over saved connections. Each request and response is *kind-tagged*: a ``kind``
discriminator selects the per-engine shape — the server fields for PostgreSQL, a file path
for SQLite — mirroring the domain's discriminated target. Responses never include the
password: it is written to and read from the keychain only, so it never leaves the machine
through the API (and a SQLite profile has none at all).
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from shirube.adapters.api.dependencies import get_connection_service, get_profile_service
from shirube.adapters.api.routes.connections import ConnectionTestResult
from shirube.application.connections import ConnectionService
from shirube.application.profiles import ProfileFields, ProfileService
from shirube.domain.connection import (
    ConnectionProfile,
    DatabaseKind,
    PostgresTarget,
    SqliteTarget,
    SslMode,
)

router = APIRouter(prefix="/profiles", tags=["profiles"])


class PostgresProfileRead(BaseModel):
    """A PostgreSQL profile as returned to the client — non-secret fields only."""

    kind: Literal[DatabaseKind.POSTGRESQL] = DatabaseKind.POSTGRESQL
    id: str
    name: str
    host: str
    port: int
    database: str
    username: str
    sslmode: SslMode
    schemas: list[str]


class SqliteProfileRead(BaseModel):
    """A SQLite profile as returned to the client — the file path and its name."""

    kind: Literal[DatabaseKind.SQLITE] = DatabaseKind.SQLITE
    id: str
    name: str
    path: str
    schemas: list[str]


# One of the per-engine read shapes, told apart by ``kind``.
ProfileRead = Annotated[PostgresProfileRead | SqliteProfileRead, Field(discriminator="kind")]


def to_read_model(profile: ConnectionProfile) -> PostgresProfileRead | SqliteProfileRead:
    """Build the matching per-engine response model from a domain profile."""
    target = profile.target
    if isinstance(target, SqliteTarget):
        return SqliteProfileRead(
            id=profile.id,
            name=profile.name,
            path=target.path,
            schemas=list(profile.schemas),
        )
    return PostgresProfileRead(
        id=profile.id,
        name=profile.name,
        host=target.host,
        port=target.port,
        database=target.database,
        username=target.username,
        sslmode=target.sslmode,
        schemas=list(profile.schemas),
    )


class PostgresProfileCreate(BaseModel):
    """Request body for creating a PostgreSQL profile."""

    kind: Literal[DatabaseKind.POSTGRESQL] = DatabaseKind.POSTGRESQL
    name: str
    host: str
    port: int = 5432
    database: str
    username: str
    password: str
    sslmode: SslMode = SslMode.PREFER
    schemas: list[str] = Field(default_factory=list)

    def to_fields(self) -> ProfileFields:
        """Extract the non-secret fields."""
        return ProfileFields(
            name=self.name,
            target=PostgresTarget(
                host=self.host,
                port=self.port,
                database=self.database,
                username=self.username,
                sslmode=self.sslmode,
            ),
            schemas=tuple(self.schemas),
        )

    def secret(self) -> str | None:
        """The password to store in the keychain."""
        return self.password


class SqliteProfileCreate(BaseModel):
    """Request body for creating a SQLite profile — a file path and a name."""

    kind: Literal[DatabaseKind.SQLITE]
    name: str
    path: str
    schemas: list[str] = Field(default_factory=list)

    def to_fields(self) -> ProfileFields:
        """Extract the non-secret fields."""
        return ProfileFields(
            name=self.name,
            target=SqliteTarget(path=self.path),
            schemas=tuple(self.schemas),
        )

    def secret(self) -> str | None:
        """SQLite has no password, so nothing is stored in the keychain."""
        return None


ProfileCreate = Annotated[
    PostgresProfileCreate | SqliteProfileCreate,
    Field(discriminator="kind"),
]


class PostgresProfileUpdate(BaseModel):
    """Request body for updating a PostgreSQL profile.

    A missing or null ``password`` leaves the stored password unchanged.
    """

    kind: Literal[DatabaseKind.POSTGRESQL] = DatabaseKind.POSTGRESQL
    name: str
    host: str
    port: int = 5432
    database: str
    username: str
    password: str | None = None
    sslmode: SslMode = SslMode.PREFER
    schemas: list[str] = Field(default_factory=list)

    def to_fields(self) -> ProfileFields:
        """Extract the non-secret fields."""
        return ProfileFields(
            name=self.name,
            target=PostgresTarget(
                host=self.host,
                port=self.port,
                database=self.database,
                username=self.username,
                sslmode=self.sslmode,
            ),
            schemas=tuple(self.schemas),
        )

    def secret(self) -> str | None:
        """The new password, or ``None`` to keep the stored one."""
        return self.password


class SqliteProfileUpdate(BaseModel):
    """Request body for updating a SQLite profile — a file path and a name."""

    kind: Literal[DatabaseKind.SQLITE]
    name: str
    path: str
    schemas: list[str] = Field(default_factory=list)

    def to_fields(self) -> ProfileFields:
        """Extract the non-secret fields."""
        return ProfileFields(
            name=self.name,
            target=SqliteTarget(path=self.path),
            schemas=tuple(self.schemas),
        )

    def secret(self) -> str | None:
        """SQLite has no password to update."""
        return None


ProfileUpdate = Annotated[
    PostgresProfileUpdate | SqliteProfileUpdate,
    Field(discriminator="kind"),
]


ServiceDep = Annotated[ProfileService, Depends(get_profile_service)]
ConnectionServiceDep = Annotated[ConnectionService, Depends(get_connection_service)]


@router.get("", response_model=list[ProfileRead])
def list_profiles(service: ServiceDep) -> list[PostgresProfileRead | SqliteProfileRead]:
    """List all saved connection profiles."""
    return [to_read_model(profile) for profile in service.list()]


@router.post("", response_model=ProfileRead, status_code=status.HTTP_201_CREATED)
def create_profile(
    body: ProfileCreate,
    service: ServiceDep,
) -> PostgresProfileRead | SqliteProfileRead:
    """Create a profile and, for an engine that has one, store its password in the keychain."""
    return to_read_model(service.create(body.to_fields(), body.secret()))


@router.get("/{profile_id}", response_model=ProfileRead)
def get_profile(profile_id: str, service: ServiceDep) -> PostgresProfileRead | SqliteProfileRead:
    """Fetch a single profile."""
    return to_read_model(service.get(profile_id))


@router.put("/{profile_id}", response_model=ProfileRead)
def update_profile(
    profile_id: str,
    body: ProfileUpdate,
    service: ServiceDep,
) -> PostgresProfileRead | SqliteProfileRead:
    """Update a profile; the password is replaced only when one is supplied."""
    return to_read_model(service.update(profile_id, body.to_fields(), body.secret()))


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(profile_id: str, service: ServiceDep) -> None:
    """Delete a profile and any stored password."""
    service.delete(profile_id)


@router.post("/{profile_id}/test", response_model=ConnectionTestResult)
def test_profile_connection(
    profile_id: str,
    service: ConnectionServiceDep,
) -> ConnectionTestResult:
    """Test a saved profile's connection, using its password from the keychain."""
    service.test_profile(profile_id)
    return ConnectionTestResult()


@router.post("/{profile_id}/test-edit", response_model=ConnectionTestResult)
def test_profile_edit(
    profile_id: str,
    body: ProfileUpdate,
    service: ConnectionServiceDep,
) -> ConnectionTestResult:
    """Test a candidate edit to a saved profile, without persisting it.

    Lets the connection form verify an edit *before* it overwrites the saved profile — the way
    creating verifies before saving — so a bad host, password or path can no longer replace a
    working profile. The password is resolved server-side (the entered one, or the stored one
    when the field is left blank), so a blank-password edit is testable without the client ever
    handling the secret. Returns ``{"ok": true}`` on success; a failure surfaces as a 400.
    """
    service.test_candidate(profile_id, body.to_fields(), body.secret())
    return ConnectionTestResult()
