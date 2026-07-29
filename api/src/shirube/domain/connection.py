"""Domain types for database connections.

A connection is *kind-tagged*: every profile names a :class:`DatabaseKind` and carries a
target shaped for that engine. A server engine (PostgreSQL) needs a host, port, database,
user and SSL mode; a file engine (SQLite) needs only a path. Rather than one wide profile
with every field nullable, each kind has its own small target type (a discriminated union),
so a SQLite profile is structurally unable to hold a stray port, and the kind tells both the
connection form and the adapter which shape to expect.
"""

from dataclasses import dataclass, field
from enum import StrEnum


class DatabaseKind(StrEnum):
    """Which database engine a connection targets.

    PostgreSQL is a server engine reached over the network; SQLite is a single local file.
    The kind selects the adapter that inspects and reads the database, and the target shape a
    profile carries. Further engines (e.g. MySQL) join this enum as their adapters land.
    """

    POSTGRESQL = "postgresql"
    SQLITE = "sqlite"


class SslMode(StrEnum):
    """PostgreSQL SSL negotiation mode.

    Mirrors libpq's ``sslmode`` values, from no encryption through to full certificate
    verification. Cloud databases typically require at least ``REQUIRE``.
    """

    DISABLE = "disable"
    ALLOW = "allow"
    PREFER = "prefer"
    REQUIRE = "require"
    VERIFY_CA = "verify-ca"
    VERIFY_FULL = "verify-full"


@dataclass(frozen=True, slots=True)
class PostgresTarget:
    """Where and how to reach a PostgreSQL database — the non-secret parts.

    Attributes:
        host: Database host. For a tunnelled connection this is ``localhost``.
        port: Database port.
        database: Name of the single database this profile connects to.
        username: Role to connect as (a read-only role is recommended).
        sslmode: SSL negotiation mode.
    """

    host: str
    port: int
    database: str
    username: str
    sslmode: SslMode = SslMode.PREFER


@dataclass(frozen=True, slots=True)
class SqliteTarget:
    """Which SQLite database file to open.

    SQLite is a single file, so a path is the whole connection — no host, port, user,
    password or SSL. The file is opened read-only (see the SQLite adapter).

    Attributes:
        path: Filesystem path to the ``.sqlite`` / ``.db`` file.
    """

    path: str


# The engine-specific part of a profile — a server target or a file target. The active
# member is what :attr:`ConnectionProfile.kind` reports.
DatabaseTarget = PostgresTarget | SqliteTarget


@dataclass(frozen=True, slots=True)
class ConnectionProfile:
    """A saved, named way to connect to one database.

    Holds only the non-secret parts of a connection; any password lives separately in the
    OS keychain, keyed by ``id`` (see :class:`~shirube.ports.repositories.SecretStore`). A
    profile maps to exactly one database — browsing another database on the same server
    means creating another profile.

    Attributes:
        id: Stable identifier (a UUID). Also the key any password is stored under in the
            keychain, and what per-database state (layouts, manual relationships) is
            attached to.
        name: Human-friendly label shown in the connection list.
        target: The engine-specific connection details (a :class:`PostgresTarget` or a
            :class:`SqliteTarget`); its type is what :attr:`kind` reports.
        schemas: Schemas to load; empty means "all non-system schemas". A schema-less
            engine such as SQLite ignores this — its one namespace is always loaded.
    """

    id: str
    name: str
    target: DatabaseTarget
    schemas: tuple[str, ...] = field(default_factory=tuple)

    @property
    def kind(self) -> DatabaseKind:
        """The engine this profile targets, derived from its target's type."""
        return (
            DatabaseKind.SQLITE
            if isinstance(self.target, SqliteTarget)
            else DatabaseKind.POSTGRESQL
        )


@dataclass(frozen=True, slots=True)
class PostgresConnectionParams:
    """The full set of values needed to open a PostgreSQL connection, including the password.

    Transient: assembled to attempt or test a connection and never persisted, since it
    carries the secret. A :class:`ConnectionProfile` with a :class:`PostgresTarget`, plus its
    keychain password, produces one of these.

    Attributes:
        host: Database host.
        port: Database port.
        database: Database name.
        username: Role to connect as.
        password: The role's password (may be empty for password-less auth).
        sslmode: SSL negotiation mode.
    """

    host: str
    port: int
    database: str
    username: str
    password: str
    sslmode: SslMode = SslMode.PREFER


@dataclass(frozen=True, slots=True)
class SqliteConnectionParams:
    """The values needed to open a SQLite database file.

    SQLite has no secret, so this is simply the file path; it is opened read-only by the
    adapter. A :class:`ConnectionProfile` with a :class:`SqliteTarget` produces one of these.

    Attributes:
        path: Filesystem path to the ``.sqlite`` / ``.db`` file.
    """

    path: str


# The transient, secret-carrying parameters for one connection attempt — the engine-specific
# counterpart to :data:`DatabaseTarget`. An adapter dispatches on which member it receives.
ConnectionParams = PostgresConnectionParams | SqliteConnectionParams
