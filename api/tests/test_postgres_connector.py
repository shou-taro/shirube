"""Unit tests for the PostgreSQL error translation.

These check that raw driver errors become plain, actionable messages, without needing a
live database.
"""

import psycopg
import pytest

from shirube.adapters.postgres.connector import PostgresConnector, _friendly_message
from shirube.domain.connection import ConnectionParams, SslMode
from shirube.domain.errors import ConnectionFailedError

_PARAMS = ConnectionParams(
    host="db.example.com",
    port=5432,
    database="shop",
    username="readonly",
    password="",
    sslmode=SslMode.REQUIRE,
)


def test_authentication_failure_names_the_user() -> None:
    message = _friendly_message(
        psycopg.OperationalError("FATAL: password authentication failed for user"),
        _PARAMS,
    )
    assert "Authentication failed" in message
    assert "readonly" in message


def test_unreachable_host_names_host_and_port() -> None:
    message = _friendly_message(
        psycopg.OperationalError("could not translate host name to address"),
        _PARAMS,
    )
    assert "Could not reach db.example.com:5432" in message


def test_missing_database() -> None:
    message = _friendly_message(
        psycopg.OperationalError('database "shop" does not exist'),
        _PARAMS,
    )
    assert "does not exist" in message


def test_real_connect_to_unreachable_port_is_translated() -> None:
    """Exercise the real psycopg connect path against a refused port.

    Port 1 refuses immediately, so this needs no database yet still drives the actual
    driver call, timeout, and error translation.
    """
    params = ConnectionParams(
        host="127.0.0.1",
        port=1,
        database="none",
        username="none",
        password="",
        sslmode=SslMode.DISABLE,
    )
    with pytest.raises(ConnectionFailedError) as exc_info:
        PostgresConnector().test_connection(params)
    assert "Could not reach 127.0.0.1:1" in exc_info.value.detail
