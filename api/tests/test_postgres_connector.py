"""Unit tests for the PostgreSQL error translation.

These check that raw driver errors become plain, actionable messages, without needing a
live database.
"""

import psycopg
import pytest

from shirube.adapters.postgres._common import friendly_message
from shirube.adapters.postgres.connector import PostgresConnector
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
    message = friendly_message(
        psycopg.OperationalError("FATAL: password authentication failed for user"),
        _PARAMS,
    )
    assert "Authentication failed" in message
    assert "readonly" in message


def test_unreachable_host_names_host_and_port() -> None:
    message = friendly_message(
        psycopg.OperationalError("could not translate host name to address"),
        _PARAMS,
    )
    assert "Could not reach db.example.com:5432" in message


def test_no_password_supplied_asks_for_one() -> None:
    """A blank password against a server that requires one is called out distinctly.

    libpq raises a client-side ``fe_sendauth: no password supplied`` here rather than an
    authentication failure, so it must map to "enter a password", not "check the
    password".
    """
    message = friendly_message(
        psycopg.OperationalError(
            'connection to server at "127.0.0.1", port 5432 failed: '
            "fe_sendauth: no password supplied"
        ),
        _PARAMS,
    )
    assert "requires a password" in message
    assert "readonly" in message


def test_missing_database() -> None:
    message = friendly_message(
        psycopg.OperationalError('database "shop" does not exist'),
        _PARAMS,
    )
    assert "does not exist" in message


def test_statement_timeout_is_translated() -> None:
    """A query cancelled by the statement timeout is distinct from a connection timeout.

    The user is connected fine; a big query simply ran too long. The message must say so
    rather than falling through to the generic "could not connect".
    """
    message = friendly_message(
        psycopg.errors.QueryCanceled("canceling statement due to statement timeout"),
        _PARAMS,
    )
    assert "statement timeout" in message.lower()
    assert "took too long" in message.lower()


def test_ssl_required() -> None:
    message = friendly_message(
        psycopg.OperationalError("server does not support SSL, but SSL was required"),
        _PARAMS,
    )
    assert "SSL" in message


def test_permission_denied() -> None:
    message = friendly_message(
        psycopg.OperationalError("permission denied for table films"),
        _PARAMS,
    )
    assert "permission" in message.lower()
    assert "CONNECT and SELECT" in message


def test_empty_host_is_named_over_the_raw_socket_error() -> None:
    """An empty host makes libpq fall back to a Unix socket; say so plainly.

    The blank host is the real cause, so it must be reported ahead of the generic
    fallback rather than surfacing psycopg's cryptic socket message.
    """
    params = ConnectionParams(
        host="",
        port=5432,
        database="shop",
        username="readonly",
        password="",
        sslmode=SslMode.PREFER,
    )
    message = friendly_message(
        psycopg.OperationalError(
            'connection to server on socket "/tmp/.s.PGSQL.5432" failed: No such file or directory'
        ),
        params,
    )
    assert "host is empty" in message.lower()


def test_unrecognised_error_falls_back_to_the_raw_message() -> None:
    message = friendly_message(psycopg.OperationalError("something unexpected went wrong"), _PARAMS)
    assert message.startswith("Could not connect:")
    assert "something unexpected went wrong" in message


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
