"""PostgreSQL connection adapter."""

from shirube.adapters.postgres._common import read_only_connection
from shirube.domain.connection import ConnectionParams


class PostgresConnector:
    """Opens read-only connections to a PostgreSQL database.

    This validates that a database can be reached; schema introspection lives in a
    separate adapter. Every probe runs in a read-only session with a statement timeout
    (see :func:`~shirube.adapters.postgres._common.read_only_connection`), matching
    shirube's safety model — the tool should never be able to change a user's database.
    """

    def test_connection(self, params: ConnectionParams) -> None:
        """Open a read-only connection and run a trivial query.

        Args:
            params: The connection parameters to try.

        Raises:
            ConnectionFailedError: if the connection or probe fails, carrying a
                translated, actionable message.
        """
        with read_only_connection(params) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
