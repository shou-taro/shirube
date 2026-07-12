"""Ports the application depends on, implemented by adapters.

These Protocols invert the dependency between the core and the outside world: the
application and domain layers depend on these interfaces, and the adapters implement
them. That keeps the core testable and lets infrastructure — the database driver, the
OS keychain, an AI provider — be swapped without touching business logic.

The Protocols are intentionally empty for now; methods are added alongside the feature
that first needs them, so an interface never runs ahead of a real use case.
"""

from typing import Protocol


class ProfileRepository(Protocol):
    """Stores and retrieves connection profiles (feat/db-connection)."""


class SchemaInspector(Protocol):
    """Introspects a database into domain metadata (feat/schema-introspection)."""


class SecretStore(Protocol):
    """Reads and writes secrets in the OS keychain (feat/db-connection).

    Passwords and API keys live here, never in the app-state database or config files.
    """


class AiProvider(Protocol):
    """Talks to an AI provider behind a common interface (M2).

    Concrete adapters cover OpenAI-compatible APIs and local Ollama.
    """
