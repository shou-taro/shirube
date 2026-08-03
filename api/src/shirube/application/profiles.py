"""Use cases for managing connection profiles."""

import uuid
from dataclasses import dataclass

from shirube.domain.connection import ConnectionProfile, DatabaseTarget
from shirube.domain.errors import ProfileNotFoundError
from shirube.ports.repositories import (
    ManualRelationshipRepository,
    ProfileRepository,
    SecretStore,
)


@dataclass(frozen=True, slots=True)
class ProfileFields:
    """The non-secret fields of a profile, as supplied when creating or updating one.

    The password is handled separately so it never travels alongside the persisted fields;
    the engine-specific details are carried by ``target`` (a server or file target), whose
    type fixes the profile's kind.

    Attributes:
        name: Human-friendly label.
        target: The engine-specific connection details (a server or file target).
        schemas: Schemas to load; empty means all non-system schemas (ignored for a
            schema-less engine such as SQLite).
    """

    name: str
    target: DatabaseTarget
    schemas: tuple[str, ...]


class ProfileService:
    """Creates, reads, updates and deletes connection profiles.

    Coordinates the profile repository (non-secret fields), the secret store (the
    password) and the profile's manual relationships so the three never drift apart:
    creating a profile writes profile and password, and deleting one removes all three.
    """

    def __init__(
        self,
        repository: ProfileRepository,
        secrets: SecretStore,
        manual_relationships: ManualRelationshipRepository,
    ) -> None:
        self._repository = repository
        self._secrets = secrets
        self._manual_relationships = manual_relationships

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

    def create(self, fields: ProfileFields, password: str | None) -> ConnectionProfile:
        """Create a profile and, for an engine that has one, store its password in the keychain.

        A ``None`` password stores nothing — the shape a keyless engine such as SQLite uses,
        the same as an Ollama AI provider that needs no key. If a password is supplied but
        cannot be stored (e.g. a locked keychain), the just-added profile is rolled back, so a
        failure never leaves a saved-but-unusable profile behind.

        Returns:
            The created profile (without the password).

        Raises:
            SecretStoreError: if a supplied password cannot be written to the keychain.
        """
        profile = ConnectionProfile(
            id=str(uuid.uuid4()),
            name=fields.name,
            target=fields.target,
            schemas=fields.schemas,
        )
        self._repository.add(profile)
        if password is None:
            return profile
        try:
            self._secrets.set_password(profile.id, password)
        except Exception:
            # Undo the add so the two stores never drift into a passwordless profile.
            self._repository.delete(profile.id)
            raise
        return profile

    def update(
        self,
        profile_id: str,
        fields: ProfileFields,
        password: str | None,
    ) -> ConnectionProfile:
        """Replace a profile's fields, and its password when one is supplied.

        A ``None`` password leaves the stored password untouched, so the client need not
        re-send it on every edit — *unless the engine changed*. Switching to a different
        engine (e.g. PostgreSQL to keyless SQLite) makes any stored password belong to the
        *old* engine, so it is removed rather than left paired with — and later reused by —
        the new one. If the keychain write (or removal) fails, the field write is rolled back
        so profile and password never drift, mirroring :meth:`create`.

        Raises:
            ProfileNotFoundError: if no profile has that id.
            SecretStoreError: if the password cannot be written to (or removed from) the
                keychain.
        """
        existing = self.get(profile_id)
        updated = ConnectionProfile(
            id=existing.id,
            name=fields.name,
            target=fields.target,
            schemas=fields.schemas,
        )
        self._repository.update(updated)
        try:
            if password is not None:
                self._secrets.set_password(profile_id, password)
            elif updated.kind is not existing.kind:
                # The stored password belonged to the previous engine; on an engine change
                # with no new password it no longer applies, so drop it rather than leave it
                # lingering under — and later reused by — a profile of a different engine.
                self._secrets.delete_password(profile_id)
        except Exception:
            # Undo the field write so the two stores never drift apart.
            self._repository.update(existing)
            raise
        return updated

    def delete(self, profile_id: str) -> None:
        """Delete a profile, its stored password and its manual relationships.

        Raises:
            ProfileNotFoundError: if no profile has that id.
        """
        self.get(profile_id)
        self._repository.delete(profile_id)
        self._secrets.delete_password(profile_id)
        # Local annotations must not outlive the profile they belong to.
        self._manual_relationships.delete_for_profile(profile_id)
