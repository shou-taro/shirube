"""Ports the application depends on, implemented by adapters.

These Protocols invert the dependency between the core and the outside world: the
application and domain layers depend on these interfaces, and the adapters implement
them. That keeps the core testable and lets infrastructure — the database driver, the
OS keychain, an AI provider — be swapped without touching business logic.

Methods are added to a port alongside the feature that first needs them, so an
interface never runs ahead of a real use case.
"""

from typing import Protocol

from shirube.domain.connection import ConnectionParams, ConnectionProfile


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
    """Introspects a database into domain metadata (feat/schema-introspection)."""


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


class AiProvider(Protocol):
    """Talks to an AI provider behind a common interface (Milestone 2 — AI navigator).

    Concrete adapters cover OpenAI-compatible APIs and local Ollama.
    """
