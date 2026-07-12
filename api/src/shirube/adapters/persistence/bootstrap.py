"""Creates the local app-state schema on startup."""

from shirube.adapters.persistence import models  # noqa: F401  (register models on Base.metadata)
from shirube.adapters.persistence.database import Base, get_engine


def bootstrap_database() -> None:
    Base.metadata.create_all(bind=get_engine())
