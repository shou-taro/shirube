"""Ports the application depends on, implemented by adapters.

These Protocols invert the dependency between the core and the outside world: the
application and domain layers depend on these interfaces, and the adapters implement
them. That keeps the core testable and lets infrastructure — the database driver, the
OS keychain, an AI provider — be swapped without touching business logic.

Methods are added to a port alongside the feature that first needs them, so an
interface never runs ahead of a real use case.
"""

from collections.abc import Sequence
from typing import Protocol

from shirube.domain.ai import AiProviderConfig
from shirube.domain.connection import ConnectionParams, ConnectionProfile
from shirube.domain.data import RowPage, RowQuery
from shirube.domain.schema import SchemaGraph


class ProfileRepository(Protocol):
    """Stores and retrieves connection profiles (non-secret fields)."""

    def list(self) -> list[ConnectionProfile]:
        """Return all saved profiles."""
        ...

    def get(self, profile_id: str) -> ConnectionProfile | None:
        """Return one profile, or ``None`` if it does not exist."""
        ...

    def add(self, profile: ConnectionProfile) -> None:
        """Insert a new profile."""
        ...

    def update(self, profile: ConnectionProfile) -> None:
        """Overwrite an existing profile's fields."""
        ...

    def delete(self, profile_id: str) -> None:
        """Delete a profile."""
        ...


class SchemaInspector(Protocol):
    """Introspects a database into domain metadata."""

    def inspect(self, params: ConnectionParams, schemas: Sequence[str]) -> SchemaGraph:
        """Read objects and their relationships from the target database.

        Args:
            params: How to connect.
            schemas: Schemas to include; empty means all non-system schemas.

        Returns:
            The schema as a graph of objects and foreign-key relationships.

        Raises:
            ConnectionFailedError: if the database cannot be reached or read.
        """
        ...


class DataReader(Protocol):
    """Reads a page of rows from a single table or view, read-only."""

    def read_rows(
        self,
        params: ConnectionParams,
        schemas: Sequence[str],
        object_id: str,
        query: RowQuery,
    ) -> RowPage:
        """Read a filtered, sorted page of an object's rows.

        Args:
            params: How to connect.
            schemas: Schemas the object may live in; empty means all non-system schemas.
            object_id: The ``schema.name`` id of the table or view to read.
            query: The page to read — limit, offset, sort and filters.

        Returns:
            The requested page of rows.

        Raises:
            ObjectNotFoundError: if no such object exists in the allowed schemas.
            InvalidQueryError: if the query names a column the object does not have.
            ConnectionFailedError: if the database cannot be reached or read.
        """
        ...


class DatabaseConnector(Protocol):
    """Opens and validates connections to a target database."""

    def test_connection(self, params: ConnectionParams) -> None:
        """Attempt a read-only connection, raising ConnectionFailedError on failure."""
        ...


class SecretStore(Protocol):
    """Reads and writes secrets in the OS keychain.

    Passwords and API keys live here, never in the app-state database or config files.
    """

    def get_password(self, profile_id: str) -> str | None:
        """Return the stored password for ``profile_id``, or ``None``."""
        ...

    def set_password(self, profile_id: str, password: str) -> None:
        """Store (or replace) the password for ``profile_id``."""
        ...

    def delete_password(self, profile_id: str) -> None:
        """Remove the password for ``profile_id`` (a no-op if absent)."""
        ...


class AiConfigRepository(Protocol):
    """Stores the app-wide AI provider configuration (non-secret fields only).

    A single active provider is configured at a time, so this holds one config or none —
    unlike the keyed collection of connection profiles. The API key is a secret and lives
    in the keychain via :class:`SecretStore`, never here.
    """

    def get(self) -> AiProviderConfig | None:
        """Return the configured provider, or ``None`` if none is set."""
        ...

    def set(self, config: AiProviderConfig) -> None:
        """Store the provider config, replacing any existing one."""
        ...

    def clear(self) -> None:
        """Remove the provider config (a no-op if none is set)."""
        ...


class AiProvider(Protocol):
    """Talks to an AI provider behind a common interface (Milestone 2 — AI navigator).

    Concrete adapters cover OpenAI-compatible APIs and local Ollama.
    """
