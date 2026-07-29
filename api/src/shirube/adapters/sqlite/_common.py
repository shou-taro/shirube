"""Shared plumbing for the SQLite adapters.

Both the connection tester and the schema inspector open a SQLite file under shirube's
safety rules — read-only, and bounded so a runaway scan cannot hang the tool — and turn
raw driver errors into plain, actionable messages. That logic lives here rather than being
duplicated per adapter.
"""

import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from urllib.parse import quote

from shirube.domain.connection import SqliteConnectionParams
from shirube.domain.errors import ConnectionFailedError

# Fail fast rather than block on a file another process holds, and cap how long any single
# query may run before it is interrupted (SQLite has no server-side statement timeout).
CONNECT_TIMEOUT_SECONDS = 5.0
STATEMENT_TIMEOUT_SECONDS = 5.0
# How often (in virtual-machine instructions) the progress handler runs to check the deadline.
# Small enough to interrupt a long scan promptly, large enough not to slow ordinary queries.
_PROGRESS_INSTRUCTIONS = 10_000


def friendly_message(exc: sqlite3.Error, params: SqliteConnectionParams) -> str:
    """Translate a SQLite driver error into a plain, actionable message.

    Args:
        exc: The error raised by ``sqlite3``.
        params: The connection parameters that were attempted.

    Returns:
        A message safe and useful to show to the user.
    """
    text = str(exc).lower()
    if not params.path.strip():
        return "No file was given. Choose the SQLite database file to open."
    if "unable to open database file" in text:
        return (
            f"Could not open '{params.path}'. Check the path is correct and the file exists "
            "and is readable."
        )
    if "not a database" in text or "file is encrypted" in text:
        return f"'{params.path}' is not a SQLite database (or it is encrypted)."
    if "database is locked" in text:
        return "The database file is locked by another program. Close it and try again."
    if "interrupted" in text:
        # The progress handler cancelled a query that ran past the statement timeout.
        return (
            "The query took too long and was cancelled. Try a smaller database, or filter to "
            "fewer rows."
        )
    return f"Could not open the SQLite database: {exc}"


@contextmanager
def read_only_connection(params: SqliteConnectionParams) -> Iterator[sqlite3.Connection]:
    """Open a SQLite file locked to read-only, with a per-query time bound.

    The file is opened through a ``file:...?mode=ro`` URI, so SQLite itself refuses every
    write — the guarantee the whole tool rests on — and rejects a path that does not exist
    rather than creating an empty database. A progress handler interrupts work once it runs
    past a :data:`STATEMENT_TIMEOUT_SECONDS` budget from opening, standing in for the
    statement timeout a server engine would enforce (shirube opens a fresh connection per
    operation, so the budget bounds each one). Any driver error, while connecting or while the
    caller runs its queries, is translated into a
    :class:`~shirube.domain.errors.ConnectionFailedError`.

    Args:
        params: The connection parameters to open with.

    Yields:
        An open, read-only SQLite connection.

    Raises:
        ConnectionFailedError: if opening or a subsequent query fails, carrying a translated,
            actionable message.
    """
    # Percent-encode the path into the URI so a space or ``#`` in it cannot be misread; the
    # query string then pins the connection to read-only.
    uri = f"file:{quote(params.path)}?mode=ro"
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(uri, uri=True, timeout=CONNECT_TIMEOUT_SECONDS)
        deadline = time.monotonic() + STATEMENT_TIMEOUT_SECONDS
        # Returning a non-zero value from the handler aborts the running query with an
        # "interrupted" OperationalError, which friendly_message reports as a timeout.
        connection.set_progress_handler(
            lambda: 1 if time.monotonic() > deadline else 0,
            _PROGRESS_INSTRUCTIONS,
        )
        yield connection
    except sqlite3.Error as exc:
        raise ConnectionFailedError(friendly_message(exc, params)) from exc
    finally:
        if connection is not None:
            connection.close()
