"""Connection-profile management endpoints.

Full CRUD over saved connections. Responses never include the password — it is written
to and read from the keychain only, so it never leaves the machine through the API.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from shirube.adapters.api.dependencies import get_connection_service, get_profile_service
from shirube.adapters.api.routes.connections import ConnectionTestResult
from shirube.application.connections import ConnectionService
from shirube.application.profiles import ProfileFields, ProfileService
from shirube.domain.connection import ConnectionProfile, SslMode

router = APIRouter(prefix="/profiles", tags=["profiles"])


class ProfileRead(BaseModel):
    """A profile as returned to the client — non-secret fields only."""

    id: str
    name: str
    host: str
    port: int
    database: str
    username: str
    sslmode: SslMode
    schemas: list[str]

    @classmethod
    def from_domain(cls, profile: ConnectionProfile) -> "ProfileRead":
        """Build the response model from a domain profile."""
        return cls(
            id=profile.id,
            name=profile.name,
            host=profile.host,
            port=profile.port,
            database=profile.database,
            username=profile.username,
            sslmode=profile.sslmode,
            schemas=list(profile.schemas),
        )


class ProfileCreate(BaseModel):
    """Request body for creating a profile."""

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
            host=self.host,
            port=self.port,
            database=self.database,
            username=self.username,
            sslmode=self.sslmode,
            schemas=tuple(self.schemas),
        )


class ProfileUpdate(BaseModel):
    """Request body for updating a profile.

    A missing or null ``password`` leaves the stored password unchanged.
    """

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
            host=self.host,
            port=self.port,
            database=self.database,
            username=self.username,
            sslmode=self.sslmode,
            schemas=tuple(self.schemas),
        )


ServiceDep = Annotated[ProfileService, Depends(get_profile_service)]
ConnectionServiceDep = Annotated[ConnectionService, Depends(get_connection_service)]


@router.get("", response_model=list[ProfileRead])
def list_profiles(service: ServiceDep) -> list[ProfileRead]:
    """List all saved connection profiles."""
    return [ProfileRead.from_domain(profile) for profile in service.list()]


@router.post("", response_model=ProfileRead, status_code=status.HTTP_201_CREATED)
def create_profile(body: ProfileCreate, service: ServiceDep) -> ProfileRead:
    """Create a profile and store its password in the keychain."""
    return ProfileRead.from_domain(service.create(body.to_fields(), body.password))


@router.get("/{profile_id}", response_model=ProfileRead)
def get_profile(profile_id: str, service: ServiceDep) -> ProfileRead:
    """Fetch a single profile."""
    return ProfileRead.from_domain(service.get(profile_id))


@router.put("/{profile_id}", response_model=ProfileRead)
def update_profile(profile_id: str, body: ProfileUpdate, service: ServiceDep) -> ProfileRead:
    """Update a profile; the password is replaced only when one is supplied."""
    return ProfileRead.from_domain(service.update(profile_id, body.to_fields(), body.password))


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(profile_id: str, service: ServiceDep) -> None:
    """Delete a profile and its stored password."""
    service.delete(profile_id)


@router.post("/{profile_id}/test", response_model=ConnectionTestResult)
def test_profile_connection(
    profile_id: str,
    service: ConnectionServiceDep,
) -> ConnectionTestResult:
    """Test a saved profile's connection, using its password from the keychain."""
    service.test_profile(profile_id)
    return ConnectionTestResult()
