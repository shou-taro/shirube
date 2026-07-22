"""Creation and light migration of the local app-state schema on start-up."""

from sqlalchemy import Engine, inspect, text

from shirube.adapters.persistence import models  # noqa: F401  (register models on Base.metadata)
from shirube.adapters.persistence.database import Base, get_engine

# Columns added to existing tables after their first release. ``create_all`` only creates
# missing *tables*, never missing columns, so each additive column is applied by hand here.
# SQLite's ``ALTER TABLE ... ADD COLUMN`` is the whole migration: a single-user local file
# needs nothing heavier than this, and every added column is nullable so existing rows are
# left valid. Keep the type clause SQLite-flavoured.
_ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "ai_provider_config": {"context_window": "INTEGER"},
}


def _apply_additive_migrations(engine: Engine) -> None:
    """Add any columns that a newer release introduced to already-created tables.

    Idempotent: a column already present (including on a freshly created database) is skipped,
    so this is safe to run on every start-up.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        for table, columns in _ADDED_COLUMNS.items():
            if table not in existing_tables:
                continue  # A fresh database already has the column from create_all.
            present = {column["name"] for column in inspector.get_columns(table)}
            for name, type_clause in columns.items():
                if name not in present:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {type_clause}"))


def bootstrap_database() -> None:
    """Create any missing app-state tables and apply additive column migrations.

    Importing ``models`` first registers every ORM model on ``Base.metadata``, so
    ``create_all`` can see them. This is safe to call on every start-up: existing tables are
    left untouched by ``create_all``, and any columns added since a table was first created
    are filled in by :func:`_apply_additive_migrations`.
    """
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    _apply_additive_migrations(engine)
