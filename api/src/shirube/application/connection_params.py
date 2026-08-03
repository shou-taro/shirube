"""Assemble transient connection parameters from a saved profile.

A :class:`~shirube.domain.connection.ConnectionProfile` holds the non-secret target; the
password (when the engine has one) lives in the keychain. Turning the two into the
secret-carrying :data:`~shirube.domain.connection.ConnectionParams` an adapter opens with is
the same small step for every use case — testing, introspecting, previewing — so it lives
here rather than being repeated in each service.
"""

from shirube.domain.connection import (
    ConnectionParams,
    ConnectionProfile,
    PostgresConnectionParams,
    SqliteConnectionParams,
    SqliteTarget,
)
from shirube.ports.repositories import SecretStore


def build_connection_params(
    profile: ConnectionProfile,
    secrets: SecretStore,
    *,
    password_override: str | None = None,
) -> ConnectionParams:
    """Build the parameters to open a profile's database, reading any password from the keychain.

    Args:
        profile: The saved profile to connect with.
        secrets: The keychain store the password is read from (unused for a keyless engine
            such as SQLite, or when ``password_override`` is given).
        password_override: A password to use instead of the stored one. Given (even as an empty
            string) it wins; ``None`` falls back to the profile's keychain password. Used to
            test a candidate edit whose password was just entered but not yet saved.

    Returns:
        The engine-specific connection parameters: a :class:`SqliteConnectionParams` for a
        file target, or a :class:`PostgresConnectionParams` (with the keychain password, or the
        override) for a server target.
    """
    target = profile.target
    if isinstance(target, SqliteTarget):
        # SQLite has no secret — the path is the whole connection.
        return SqliteConnectionParams(path=target.path)
    password = (
        password_override if password_override is not None else secrets.get_password(profile.id)
    )
    return PostgresConnectionParams(
        host=target.host,
        port=target.port,
        database=target.database,
        username=target.username,
        password=password or "",
        sslmode=target.sslmode,
    )
