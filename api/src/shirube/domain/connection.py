"""Domain types for database connections."""

from dataclasses import dataclass, field
from enum import StrEnum


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
class ConnectionProfile:
    """A saved, named way to connect to one database.

    Holds only the non-secret parts of a connection; the password lives separately in
    the OS keychain, keyed by ``id`` (see :class:`~shirube.ports.repositories.SecretStore`).
    A profile maps to exactly one database — browsing another database on the same
    server means creating another profile.

    Attributes:
        id: Stable identifier (a UUID). Also the key the password is stored under in the
            keychain, and what per-database state (layouts, manual relationships) is
            later attached to.
        name: Human-friendly label shown in the connection list.
        host: Database host. For a tunnelled connection this is ``localhost``.
        port: Database port.
        database: Name of the single database this profile connects to.
        username: Role to connect as (a read-only role is recommended).
        sslmode: SSL negotiation mode.
        schemas: Schemas to load; empty means "all non-system schemas".
    """

    id: str
    name: str
    host: str
    port: int
    database: str
    username: str
    sslmode: SslMode = SslMode.PREFER
    schemas: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class ConnectionParams:
    """The full set of values needed to open a connection, including the password.

    Transient: assembled to attempt or test a connection and never persisted, since it
    carries the secret. A :class:`ConnectionProfile` plus its keychain password produce
    one of these.

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
