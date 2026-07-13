"""SQLAlchemy engine and session factory for shirube's local app state.

"App state" is shirube's own data — connection profiles, saved layouts, manual
relationships, chat history — kept in a local SQLite file. It is entirely separate from
the databases a user connects to and explores.

The engine and session factory are created lazily and cached so that importing this
module has no side effects (no directory created, no file opened). That is what lets
tests redirect the data directory before anything touches the disk.
"""

from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from shirube.config import get_settings


class Base(DeclarativeBase):
    """Declarative base for shirube's local app-state tables."""


@lru_cache
def get_engine() -> Engine:
    """Return the cached SQLite engine, creating the data directory on first use.

    Returns:
        The process-wide SQLAlchemy engine for the app-state database.
    """
    settings = get_settings()
    # Ensure the per-user data directory exists before SQLite tries to open the file.
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return create_engine(settings.database_url, future=True)


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    """Return the cached session factory bound to the app-state engine.

    Returns:
        A configured :class:`sessionmaker`; call it to obtain a new session.
    """
    return sessionmaker(bind=get_engine(), expire_on_commit=False)
