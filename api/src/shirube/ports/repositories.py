"""Ports the application depends on, implemented by adapters.

These Protocols fix the dependency direction (adapters depend on the core, not the
reverse). Concrete methods are added alongside the features that need them.
"""

from typing import Protocol


class ProfileRepository(Protocol):
    """Stores and retrieves connection profiles (feat/db-connection)."""


class SchemaInspector(Protocol):
    """Introspects a database into domain metadata (feat/schema-introspection)."""


class SecretStore(Protocol):
    """Reads and writes secrets in the OS keychain (feat/db-connection)."""


class AiProvider(Protocol):
    """Talks to an AI provider behind a common interface (M2)."""
