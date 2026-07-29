"""Tests for the native SQLite file picker — the adapter and its endpoint.

The real dialog needs a display, so the adapter is tested with the subprocess mocked, and the
endpoint with the picker overridden. No window is ever shown.
"""

import subprocess
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from shirube.adapters.api.app import create_app
from shirube.adapters.api.dependencies import get_file_picker
from shirube.adapters.system import file_dialog
from shirube.adapters.system.file_dialog import pick_sqlite_file
from shirube.domain.errors import FileDialogUnavailableError


def test_dependency_provides_the_native_picker() -> None:
    """The DI provider hands the endpoint the real native picker."""
    assert get_file_picker() is pick_sqlite_file


class _CompletedProcess:
    """A stand-in for ``subprocess.run``'s result."""

    def __init__(self, returncode: int, stdout: str) -> None:
        self.returncode = returncode
        self.stdout = stdout


def test_returns_the_chosen_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        file_dialog.subprocess,
        "run",
        lambda *args, **kwargs: _CompletedProcess(0, "/data/chinook.sqlite\n"),
    )
    assert file_dialog.pick_sqlite_file() == "/data/chinook.sqlite"


def test_cancelling_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """An empty line (the dialog was cancelled) becomes ``None``, not an empty path."""
    monkeypatch.setattr(
        file_dialog.subprocess,
        "run",
        lambda *args, **kwargs: _CompletedProcess(0, "\n"),
    )
    assert file_dialog.pick_sqlite_file() is None


def test_a_nonzero_exit_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    """A Tk-less interpreter (or no display) exits non-zero, so the picker is unavailable."""
    monkeypatch.setattr(
        file_dialog.subprocess,
        "run",
        lambda *args, **kwargs: _CompletedProcess(1, ""),
    )
    with pytest.raises(FileDialogUnavailableError):
        file_dialog.pick_sqlite_file()


def test_a_failed_launch_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(*args: object, **kwargs: object) -> None:
        raise OSError("cannot spawn")

    monkeypatch.setattr(file_dialog.subprocess, "run", _boom)
    with pytest.raises(FileDialogUnavailableError):
        file_dialog.pick_sqlite_file()


def test_a_timeout_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    def _timeout(*args: object, **kwargs: object) -> None:
        raise subprocess.TimeoutExpired(cmd="python", timeout=1)

    monkeypatch.setattr(file_dialog.subprocess, "run", _timeout)
    with pytest.raises(FileDialogUnavailableError):
        file_dialog.pick_sqlite_file()


def _client(picker: Callable[[], str | None]) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_file_picker] = lambda: picker
    return TestClient(app)


def test_endpoint_returns_the_picked_path() -> None:
    with _client(lambda: "/data/sample.sqlite") as client:
        response = client.post("/api/connections/pick-file")
    assert response.status_code == 200
    assert response.json() == {"path": "/data/sample.sqlite"}


def test_endpoint_reports_a_cancel_as_null() -> None:
    with _client(lambda: None) as client:
        response = client.post("/api/connections/pick-file")
    assert response.status_code == 200
    assert response.json() == {"path": None}


def test_endpoint_returns_503_when_no_dialog_is_available() -> None:
    def _unavailable() -> str | None:
        raise FileDialogUnavailableError

    with _client(_unavailable) as client:
        response = client.post("/api/connections/pick-file")
    assert response.status_code == 503
    assert "directly" in response.json()["detail"]
