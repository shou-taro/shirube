"""Shared plumbing for the PostgreSQL adapters.

Both the connection tester and the schema inspector need to open a connection under
shirube's safety rules and turn raw driver errors into plain, actionable messages, so
that logic lives here rather than being duplicated per adapter.
"""

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg

from shirube.domain.connection import ConnectionParams
from shirube.domain.errors import ConnectionFailedError

# Fail fast rather than hang on an unreachable host, and cap any query we run.
CONNECT_TIMEOUT_SECONDS = 5
STATEMENT_TIMEOUT_MS = 5000


def friendly_message(exc: psycopg.Error, params: ConnectionParams) -> str:
    """Translate a driver error into a plain, actionable message.

    psycopg's own messages are terse and often cryptic, so common failures are mapped to
    guidance a developer can act on. The specific host, database and user are woven in
    to make the message concrete.

    Args:
        exc: The error raised by psycopg.
        params: The connection parameters that were attempted.

    Returns:
        A message safe and useful to show to the user.
    """
    sqlstate = exc.sqlstate
    text = str(exc).lower()
    # An empty host makes libpq fall back to a local Unix socket (e.g. "connection to
    # server on socket ...failed"), which is confusing when the user simply left the
    # field blank. Catch it first and point them at the real cause.
    if not params.host.strip():
        return "The host is empty. Enter the database host (for example 'localhost')."
    if "no password supplied" in text or "fe_sendauth" in text:
        # A blank password against a server that demands one. Distinct from a *wrong*
        # password (28P01) — the fix is to supply one, not to correct it. Some servers
        # need none (trust/peer auth), so this is only reported when the server asks.
        return f"This server requires a password for user '{params.username}'. Enter the password."
    if sqlstate == "28P01" or "authentication failed" in text:
        return (
            f"Authentication failed for user '{params.username}'. Check the username and password."
        )
    if sqlstate == "3D000" or ("database" in text and "does not exist" in text):
        return f"Database '{params.database}' does not exist."
    if any(
        hint in text
        for hint in (
            "could not translate host name",
            "could not connect",
            "connection refused",
            "timeout expired",
            "connection timed out",
        )
    ):
        return (
            f"Could not reach {params.host}:{params.port}. Check the host and port, and "
            "that the server (or SSH tunnel) is running."
        )
    if sqlstate == "57014" or "statement timeout" in text:
        # Connected fine, but a query ran past shirube's statement timeout and was
        # cancelled — distinct from a *connection* timeout above. Common on a very large
        # table or catalogue, so point at narrowing the work rather than the connection.
        return (
            "The database took too long to respond and the query was cancelled "
            "(statement timeout). Try a smaller schema, or filter to fewer rows."
        )
    if "ssl" in text:
        return "The server requires SSL. Try setting sslmode to 'require' or higher."
    if sqlstate == "42501" or "permission denied" in text:
        return (
            "Connected, but the role lacks permission. A read-only role needs CONNECT and SELECT."
        )
    return f"Could not connect: {exc}"


@contextmanager
def read_only_connection(params: ConnectionParams) -> Iterator[psycopg.Connection]:
    """Open a PostgreSQL connection locked to read-only, with timeouts applied.

    The session is set ``default_transaction_read_only`` and given a statement timeout,
    so shirube can never modify the target database or hang on a slow query — the
    guarantee the whole tool rests on. Any driver error, whether while connecting or
    while the caller runs its queries, is translated into a
    :class:`~shirube.domain.errors.ConnectionFailedError`.

    Args:
        params: The connection parameters to open with.

    Yields:
        An open, read-only psycopg connection.

    Raises:
        ConnectionFailedError: if connecting or a subsequent query fails, carrying a
            translated, actionable message.
    """
    try:
        with psycopg.connect(
            host=params.host,
            port=params.port,
            dbname=params.database,
            user=params.username,
            password=params.password,
            sslmode=params.sslmode.value,
            connect_timeout=CONNECT_TIMEOUT_SECONDS,
        ) as connection:
            # Enforce read-only at the *connection* level, before any transaction starts.
            # Doing it with ``SET default_transaction_read_only = on`` would be too late:
            # that SET itself opens the transaction the caller then runs in, and a
            # session default only governs transactions that begin after it — so that
            # first transaction would stay read-write and a write would slip through.
            # psycopg's ``connection.read_only`` applies the mode to every transaction on
            # the connection, so the caller's queries are genuinely read-only.
            connection.read_only = True
            with connection.cursor() as cursor:
                cursor.execute(f"SET statement_timeout = {STATEMENT_TIMEOUT_MS}")
            yield connection
    except psycopg.Error as exc:
        raise ConnectionFailedError(friendly_message(exc, params)) from exc
