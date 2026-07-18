"""Tests for configuration parsing, derived paths, and the loopback check.

These are pure and need no database: build a :class:`Settings` from the environment and
assert what it reads and derives.
"""

from pathlib import Path

import pytest

from shirube.__main__ import _is_loopback
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
    monkeypatch.setenv("SHIRUBE_HOST", "0.0.0.0")
    monkeypatch.setenv("SHIRUBE_PORT", "9999")
    monkeypatch.setenv("SHIRUBE_LOG_LEVEL", "DEBUG")
    monkeypatch.setenv("SHIRUBE_OPEN_BROWSER", "false")
    monkeypatch.setenv("SHIRUBE_ALLOWED_HOSTS", '["example.test", "127.0.0.1"]')

    settings = Settings()

    assert settings.host == "0.0.0.0"
    assert settings.port == 9999
    assert settings.log_level == "DEBUG"
    assert settings.open_browser is False
    assert settings.allowed_hosts == ["example.test", "127.0.0.1"]


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


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("127.0.0.1", True),
        ("127.5.5.5", True),
        ("localhost", True),
        ("::1", True),
        ("[::1]", True),
        ("0.0.0.0", False),
        ("192.168.1.10", False),
        ("example.com", False),
    ],
)
def test_is_loopback(host: str, expected: bool) -> None:
    assert _is_loopback(host) is expected
