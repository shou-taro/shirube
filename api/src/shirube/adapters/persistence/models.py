"""ORM models for shirube's local app state.

Importing this module registers every model on ``Base.metadata``, so the start-up
bootstrap can create the corresponding tables.
"""

from sqlalchemy import JSON, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from shirube.adapters.persistence.database import Base


class ConnectionProfileRow(Base):
    """Persisted form of a connection profile — non-secret fields only.

    The password is never stored here; it lives in the OS keychain, keyed by ``id``.
    ``schemas`` is held as a JSON array of schema names.
    """

    __tablename__ = "connection_profiles"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    host: Mapped[str] = mapped_column(String)
    port: Mapped[int] = mapped_column(Integer)
    database: Mapped[str] = mapped_column(String)
    username: Mapped[str] = mapped_column(String)
    sslmode: Mapped[str] = mapped_column(String)
    schemas: Mapped[list[str]] = mapped_column(JSON)


# The single row's primary key. The AI provider is configured once, app-wide, so the table
# holds at most one row under this constant id.
AI_PROVIDER_CONFIG_ID = "default"


class AiProviderConfigRow(Base):
    """Persisted form of the app-wide AI provider configuration — non-secret fields only.

    A singleton: one active provider at a time, so the table holds at most one row, keyed
    by the constant :data:`AI_PROVIDER_CONFIG_ID`. The API key is never stored here; it
    lives in the OS keychain.
    """

    __tablename__ = "ai_provider_config"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=AI_PROVIDER_CONFIG_ID)
    kind: Mapped[str] = mapped_column(String)
    model: Mapped[str] = mapped_column(String)
    base_url: Mapped[str | None] = mapped_column(String, nullable=True)
