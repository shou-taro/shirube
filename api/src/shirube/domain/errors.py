"""Base error types shared across the domain and application layers."""


class ShirubeError(Exception):
    """Base class for expected, user-facing Shirube errors.

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
