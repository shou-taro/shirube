"""Base error types shared across the domain and application layers."""


class ShirubeError(Exception):
    """Base class for expected, user-facing shirube errors.

    Raising a subclass signals a condition we anticipate — bad input, a missing
    resource, a refused connection — rather than a bug. The API layer catches these and
    turns them into a clean HTTP response using the attributes below, so raw exception
    text is never leaked to the client.

    Attributes:
        status_code: HTTP status to respond with.
        detail: Human-readable message that is safe to show to the caller.
    """

    status_code: int = 400
    detail: str = "The request could not be processed"

    def __init__(self, detail: str | None = None) -> None:
        """Optionally override the class-level message with a specific one.

        Args:
            detail: A specific message to show the caller; falls back to the class
                default when omitted.
        """
        if detail is not None:
            self.detail = detail
        super().__init__(self.detail)


class ProfileNotFoundError(ShirubeError):
    """Raised when a connection profile does not exist."""

    status_code = 404
    detail = "Connection profile not found"


class ConnectionFailedError(ShirubeError):
    """Raised when a database connection cannot be established.

    Carries a human-readable, actionable message translated from the underlying driver
    error (see the PostgreSQL connector).
    """

    status_code = 400
    detail = "Could not connect to the database"
