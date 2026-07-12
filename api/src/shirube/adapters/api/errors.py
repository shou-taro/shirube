"""Maps domain errors to HTTP responses."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from shirube.domain.errors import ShirubeError


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ShirubeError)
    async def _handle_shirube_error(request: Request, exc: ShirubeError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
