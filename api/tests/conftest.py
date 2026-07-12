"""Shared test fixtures."""

from collections.abc import Iterator
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _isolated_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Point Shirube's data directory at a throwaway path for each test."""
    monkeypatch.setenv("SHIRUBE_DATA_DIR", str(tmp_path))
    from shirube.adapters.persistence import database
    from shirube.config import get_settings

    get_settings.cache_clear()
    database.get_engine.cache_clear()
    database.get_session_factory.cache_clear()
    yield
    get_settings.cache_clear()
    database.get_engine.cache_clear()
    database.get_session_factory.cache_clear()
