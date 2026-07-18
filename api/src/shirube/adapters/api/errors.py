"""Translation of domain errors into HTTP responses."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from shirube.domain.errors import ShirubeError
from shirube.logging_config import get_logger

_logger = get_logger("shirube.error")


def register_exception_handlers(app: FastAPI) -> None:
    """Register the application's exception handlers.

    Maps every :class:`ShirubeError` to a JSON response built from the error's own
    status code and message. Unexpected exceptions are deliberately left to FastAPI's
    default handler, so genuine bugs surface as 500s rather than being masked (the
    request middleware logs their traceback).

    Args:
        app: The application to attach handlers to.
    """

    @app.exception_handler(ShirubeError)
    async def _handle_shirube_error(request: Request, exc: ShirubeError) -> JSONResponse:
        """Render a :class:`ShirubeError` as ``{"detail": ...}`` with its status code.

        The response carries only the translated, user-safe message, but the log keeps
        the underlying cause too (e.g. the raw psycopg error behind "could not connect")
        — which is exactly what is needed to diagnose the failure later.
        """
        # ``raise ... from exc`` at the raise site leaves the original on ``__cause__``.
        # It is logged (as metadata about *why* the request failed) but never returned to
        # the caller, whose response carries only the translated, user-safe detail.
        cause = repr(exc.__cause__) if exc.__cause__ is not None else None
        _logger.warning(
            "request_error",
            method=request.method,
            path=request.url.path,
            error=type(exc).__name__,
            status=exc.status_code,
            detail=exc.detail,
            cause=cause,
        )
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
