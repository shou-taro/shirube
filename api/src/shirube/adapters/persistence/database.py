"""SQLAlchemy engine and session factory for Shirube's local app state."""

from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from shirube.config import get_settings


class Base(DeclarativeBase):
    """Declarative base for Shirube's local app-state tables."""


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return create_engine(settings.database_url, future=True)


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)
