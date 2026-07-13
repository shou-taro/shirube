"""PostgreSQL connection adapter."""

import psycopg

from shirube.domain.connection import ConnectionParams
from shirube.domain.errors import ConnectionFailedError

# Fail fast rather than hang on an unreachable host, and cap any probe query.
_CONNECT_TIMEOUT_SECONDS = 5
_STATEMENT_TIMEOUT_MS = 5000


def _friendly_message(exc: psycopg.Error, params: ConnectionParams) -> str:
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
    if "ssl" in text:
        return "The server requires SSL. Try setting sslmode to 'require' or higher."
    if sqlstate == "42501" or "permission denied" in text:
        return (
            "Connected, but the role lacks permission. A read-only role needs CONNECT and SELECT."
        )
    return f"Could not connect: {exc}"


class PostgresConnector:
    """Opens read-only connections to a PostgreSQL database.

    For now this only validates that a database can be reached (feat/db-connection);
    schema introspection and querying arrive with later features. Every probe runs in a
    read-only transaction with a statement timeout, matching Shirube's safety model —
    the tool should never be able to change a user's database.
    """

    def test_connection(self, params: ConnectionParams) -> None:
        """Open a read-only connection and run a trivial query.

        Args:
            params: The connection parameters to try.

        Raises:
            ConnectionFailedError: if the connection or probe fails, carrying a
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
                connect_timeout=_CONNECT_TIMEOUT_SECONDS,
            ) as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SET TRANSACTION READ ONLY")
                    cursor.execute(f"SET statement_timeout = {_STATEMENT_TIMEOUT_MS}")
                    cursor.execute("SELECT 1")
        except psycopg.Error as exc:
            raise ConnectionFailedError(_friendly_message(exc, params)) from exc
