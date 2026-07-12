"""Creation of the local app-state schema on start-up."""

from shirube.adapters.persistence import models  # noqa: F401  (register models on Base.metadata)
from shirube.adapters.persistence.database import Base, get_engine


def bootstrap_database() -> None:
    """Create any missing app-state tables.

    Importing ``models`` first registers every ORM model on ``Base.metadata``, so
    ``create_all`` can see them. This is safe to call on every start-up: existing tables
    are left untouched. There are no models yet, so for now this simply creates the
    (empty) database file.
    """
    Base.metadata.create_all(bind=get_engine())
