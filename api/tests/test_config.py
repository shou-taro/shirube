"""Tests for configuration parsing and derived paths.

These are pure and need no database: build a :class:`Settings` from the environment and
assert what it reads and derives.
"""

from pathlib import Path

import pytest

from shirube.config import Settings


def test_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    # The shared fixture presets a couple of SHIRUBE_* vars; clear them to see the
    # code's own defaults.
    monkeypatch.delenv("SHIRUBE_ALLOWED_HOSTS", raising=False)
    monkeypatch.delenv("SHIRUBE_DATA_DIR", raising=False)

    settings = Settings()

    assert settings.host == "127.0.0.1"
    assert settings.port == 7472
    assert settings.log_level == "INFO"
    assert settings.open_browser is True
    assert settings.allowed_hosts == ["127.0.0.1", "localhost"]


def test_environment_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SHIRUBE_PORT", "9999")
    monkeypatch.setenv("SHIRUBE_LOG_LEVEL", "DEBUG")
    monkeypatch.setenv("SHIRUBE_OPEN_BROWSER", "false")
    monkeypatch.setenv("SHIRUBE_ALLOWED_HOSTS", '["example.test", "127.0.0.1"]')

    settings = Settings()

    assert settings.port == 9999
    assert settings.log_level == "DEBUG"
    assert settings.open_browser is False
    assert settings.allowed_hosts == ["example.test", "127.0.0.1"]


def test_host_is_fixed_to_loopback_and_ignores_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Binding beyond loopback would expose an unauthenticated API on the network, so the
    # bind host is not a configurable field — SHIRUBE_HOST must have no effect.
    monkeypatch.setenv("SHIRUBE_HOST", "0.0.0.0")

    assert Settings().host == "127.0.0.1"


def test_paths_derive_from_the_data_dir(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("SHIRUBE_DATA_DIR", str(tmp_path))

    settings = Settings()

    assert settings.data_dir == tmp_path
    assert settings.database_path == tmp_path / "shirube.db"
    assert settings.log_path == tmp_path / "shirube.log"
    assert settings.database_url == f"sqlite:///{settings.database_path}"
