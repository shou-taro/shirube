"""Translation of domain errors into HTTP responses."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from shirube.domain.errors import ShirubeError


def register_exception_handlers(app: FastAPI) -> None:
    """Register the application's exception handlers.

    Maps every :class:`ShirubeError` to a JSON response built from the error's own
    status code and message. Unexpected exceptions are deliberately left to FastAPI's
    default handler, so genuine bugs surface as 500s rather than being masked.

    Args:
        app: The application to attach handlers to.
    """

    @app.exception_handler(ShirubeError)
    async def _handle_shirube_error(request: Request, exc: ShirubeError) -> JSONResponse:
        """Render a :class:`ShirubeError` as ``{"detail": ...}`` with its status code."""
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
