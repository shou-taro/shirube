"""Tests for the local web-surface hardening.

shirube serves a local API, so the risks are browser-driven: a page on another origin
reaching the API by rebinding its host to 127.0.0.1. These check the two guards — Host
validation and the response security headers.
"""

from fastapi.testclient import TestClient

from shirube.adapters.api.app import create_app


def test_rejects_unrecognised_host_header() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/health", headers={"host": "evil.example.com"})

    # DNS-rebinding requests arrive with the attacker's own hostname — refused.
    assert response.status_code == 400


def test_accepts_a_loopback_host_header() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/health", headers={"host": "127.0.0.1:7472"})

    assert response.status_code == 200


def test_responses_carry_security_headers() -> None:
    with TestClient(create_app()) as client:
        response = client.get("/api/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert "default-src 'self'" in response.headers["Content-Security-Policy"]
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
