"""Use cases for managing connection profiles."""

import uuid
from dataclasses import dataclass

from shirube.domain.connection import ConnectionProfile, SslMode
from shirube.domain.errors import ProfileNotFoundError
from shirube.ports.repositories import ProfileRepository, SecretStore


@dataclass(frozen=True, slots=True)
class ProfileFields:
    """The non-secret fields of a profile, as supplied when creating or updating one.

    The password is handled separately so it never travels alongside the persisted
    fields.
    """

    name: str
    host: str
    port: int
    database: str
    username: str
    sslmode: SslMode
    schemas: tuple[str, ...]


class ProfileService:
    """Creates, reads, updates and deletes connection profiles.

    Coordinates the profile repository (non-secret fields) and the secret store (the
    password) so the two never drift apart: creating a profile writes both and deleting
    one removes both.
    """

    def __init__(self, repository: ProfileRepository, secrets: SecretStore) -> None:
        self._repository = repository
        self._secrets = secrets

    def list(self) -> list[ConnectionProfile]:
        """Return all saved profiles."""
        return self._repository.list()

    def get(self, profile_id: str) -> ConnectionProfile:
        """Return one profile.

        Raises:
            ProfileNotFoundError: if no profile has that id.
        """
        profile = self._repository.get(profile_id)
        if profile is None:
            raise ProfileNotFoundError
        return profile

    def create(self, fields: ProfileFields, password: str) -> ConnectionProfile:
        """Create a profile and store its password in the keychain.

        Returns:
            The created profile (without the password).
        """
        profile = ConnectionProfile(
            id=str(uuid.uuid4()),
            name=fields.name,
            host=fields.host,
            port=fields.port,
            database=fields.database,
            username=fields.username,
            sslmode=fields.sslmode,
            schemas=fields.schemas,
        )
        self._repository.add(profile)
        self._secrets.set_password(profile.id, password)
        return profile

    def update(
        self, profile_id: str, fields: ProfileFields, password: str | None
    ) -> ConnectionProfile:
        """Replace a profile's fields, and its password when one is supplied.

        A ``None`` password leaves the stored password untouched, so the client need not
        re-send it on every edit.

        Raises:
            ProfileNotFoundError: if no profile has that id.
        """
        existing = self.get(profile_id)
        updated = ConnectionProfile(
            id=existing.id,
            name=fields.name,
            host=fields.host,
            port=fields.port,
            database=fields.database,
            username=fields.username,
            sslmode=fields.sslmode,
            schemas=fields.schemas,
        )
        self._repository.update(updated)
        if password is not None:
            self._secrets.set_password(profile_id, password)
        return updated

    def delete(self, profile_id: str) -> None:
        """Delete a profile and its stored password.

        Raises:
            ProfileNotFoundError: if no profile has that id.
        """
        self.get(profile_id)
        self._repository.delete(profile_id)
        self._secrets.delete_password(profile_id)
