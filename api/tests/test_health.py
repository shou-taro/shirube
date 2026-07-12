"""Tests for the health endpoint."""

from fastapi.testclient import TestClient

from shirube import __version__
from shirube.adapters.api.app import create_app


def test_health_returns_ok() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__
