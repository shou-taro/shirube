"""SQLite connection adapter."""

from shirube.adapters.sqlite._common import read_only_connection
from shirube.domain.connection import SqliteConnectionParams


class SqliteConnector:
    """Opens read-only connections to a SQLite database file.

    This validates that a file can be opened and read; schema introspection lives in a
    separate adapter. Every probe runs read-only (see
    :func:`~shirube.adapters.sqlite._common.read_only_connection`), matching shirube's safety
    model — the tool should never be able to change a user's database.
    """

    def test_connection(self, params: SqliteConnectionParams) -> None:
        """Open the file read-only and run a trivial query.

        Args:
            params: The connection parameters to try.

        Raises:
            ConnectionFailedError: if the file cannot be opened or read, carrying a
                translated, actionable message.
        """
        with read_only_connection(params) as connection:
            connection.execute("SELECT 1")
