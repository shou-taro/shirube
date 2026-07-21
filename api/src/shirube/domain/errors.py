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


class ObjectNotFoundError(ShirubeError):
    """Raised when a requested table or view is not in the connected database."""

    status_code = 404
    detail = "Table or view not found"


class InvalidQueryError(ShirubeError):
    """Raised when a row query names a column the object does not have.

    Column and operator choices are validated against the object's real columns before
    any SQL is built, so an unknown column is refused rather than reaching the database.
    """

    status_code = 400
    detail = "The query referenced a column that does not exist"


class SecretStoreError(ShirubeError):
    """Raised when the OS keychain cannot be read or written.

    A locked keychain, a missing backend, or the user declining access all surface here
    rather than as an unhandled 500, so the caller gets a clear, translated message.
    """

    status_code = 500
    detail = "Could not access the OS keychain where passwords are stored"


class InvalidProviderConfigError(ShirubeError):
    """Raised when an AI provider configuration is incomplete or inconsistent.

    An OpenAI-compatible provider needs a base URL (there is no default endpoint), and
    every provider needs a model name — the fields are checked before anything is stored,
    so a half-configured provider is refused rather than saved.
    """

    status_code = 400
    detail = "The AI provider configuration is incomplete"


class ProviderNotConfiguredError(ShirubeError):
    """Raised when the AI navigator is used before any provider has been configured.

    The navigator has no default provider — the user chooses one deliberately — so a chat
    request made before then is refused with a message pointing them at the settings, rather
    than failing obscurely deeper in.
    """

    status_code = 400
    detail = "No AI provider is configured. Choose one in Settings before using the navigator."


class ProviderCheckError(ShirubeError):
    """Raised when a provider configuration cannot be reached or authenticated.

    The connection check (a cheap model-listing call) failed — a wrong base URL, an
    unreachable model server, or a rejected API key — so the settings can report the problem
    before the configuration is saved, rather than letting it surface only when the navigator
    is first asked a question.
    """

    status_code = 400
    detail = "The AI provider could not be reached."
