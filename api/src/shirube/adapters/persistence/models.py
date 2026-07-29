"""ORM models for shirube's local app state.

Importing this module registers every model on ``Base.metadata``, so the start-up
bootstrap can create the corresponding tables.
"""

from sqlalchemy import JSON, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from shirube.adapters.persistence.database import Base
from shirube.domain.connection import DatabaseKind


class ConnectionProfileRow(Base):
    """Persisted form of a connection profile — non-secret fields only.

    The password is never stored here; it lives in the OS keychain, keyed by ``id``.
    ``schemas`` is held as a JSON array of schema names.

    The table is flat across engines: ``kind`` names the engine, and the server columns
    (``host`` … ``sslmode``) or the file column (``path``) carry that engine's target. The
    server columns predate multi-engine support and are still ``NOT NULL``, so a SQLite row —
    which has no host or port — writes empty placeholders into them; the repository reads only
    the columns its ``kind`` calls for. ``kind`` defaults to ``postgresql`` so rows written
    before the column existed read back as PostgreSQL.
    """

    __tablename__ = "connection_profiles"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String, default=DatabaseKind.POSTGRESQL.value)
    host: Mapped[str] = mapped_column(String)
    port: Mapped[int] = mapped_column(Integer)
    database: Mapped[str] = mapped_column(String)
    username: Mapped[str] = mapped_column(String)
    sslmode: Mapped[str] = mapped_column(String)
    path: Mapped[str | None] = mapped_column(String, nullable=True)
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
    context_window: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ManualRelationshipRow(Base):
    """Persisted form of a user-drawn relationship — a link the database does not declare.

    Scoped to one connection profile (``profile_id``). The unique constraint stops the same
    column-to-column link being stored twice for a profile. Rows are keyed by an opaque id,
    and reference their tables and columns by name (the schema has no stable object ids),
    so a link whose table or column is later renamed or dropped simply stops being drawn.
    """

    __tablename__ = "manual_relationships"
    __table_args__ = (
        UniqueConstraint(
            "profile_id",
            "source_schema",
            "source_table",
            "source_column",
            "target_schema",
            "target_table",
            "target_column",
            name="uq_manual_relationship",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    profile_id: Mapped[str] = mapped_column(String, index=True)
    source_schema: Mapped[str] = mapped_column(String)
    source_table: Mapped[str] = mapped_column(String)
    source_column: Mapped[str] = mapped_column(String)
    target_schema: Mapped[str] = mapped_column(String)
    target_table: Mapped[str] = mapped_column(String)
    target_column: Mapped[str] = mapped_column(String)
