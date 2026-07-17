"""FastAPI application factory (a driving adapter).

This is the HTTP entry point into the application core. In a packaged build it also
serves the compiled single-page app, so the whole tool runs from one process on one
origin; in development the Vite dev server serves the UI and proxies API calls here.
"""

import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles

from shirube import __version__
from shirube.adapters.api.errors import register_exception_handlers
from shirube.adapters.api.routes import connections, data, health, profiles, schema
from shirube.adapters.persistence.bootstrap import bootstrap_database

# The built SPA, copied here by scripts/build.sh and bundled into the wheel. It is
# absent during development (git-ignored), where Vite serves the UI instead — hence the
# existence check in create_app().
STATIC_DIR = Path(__file__).resolve().parents[2] / "static"

_logger = logging.getLogger("shirube.request")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Run start-up and shutdown work around the application's lifetime.

    On start-up the local app-state database is created if missing. There is nothing to
    tear down yet, so control simply yields back to the server.

    Args:
        app: The FastAPI application (unused; required by the lifespan signature).

    Yields:
        None, once start-up has completed.
    """
    bootstrap_database()
    yield


def create_app() -> FastAPI:
    """Build and configure the FastAPI application.

    Wires up exception handling and the API routes, and — when the SPA has been built
    and bundled — mounts it at the root so the UI and API share a single origin.

    Returns:
        The configured application instance.
    """
    app = FastAPI(title="shirube", version=__version__, lifespan=lifespan)

    @app.middleware("http")
    async def _log_requests(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Log each request's outcome — method, path, status and duration.

        Only metadata is recorded: never the query string, request body or response
        content, so filter values and row data stay out of the log. An exception that
        escapes the handlers (a genuine bug) is logged with its traceback and re-raised
        for FastAPI's default 500.
        """
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            elapsed_ms = (time.perf_counter() - start) * 1000
            _logger.exception(
                "%s %s failed after %.0f ms", request.method, request.url.path, elapsed_ms
            )
            raise
        elapsed_ms = (time.perf_counter() - start) * 1000
        _logger.info(
            "%s %s -> %d (%.0f ms)",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response

    register_exception_handlers(app)
    app.include_router(health.router, prefix="/api")
    app.include_router(profiles.router, prefix="/api")
    app.include_router(connections.router, prefix="/api")
    app.include_router(schema.router, prefix="/api")
    app.include_router(data.router, prefix="/api")
    if STATIC_DIR.is_dir():
        # Mounted after the API router so "/api/*" matches first; this then catches
        # every remaining path and serves index.html for "/".
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="spa")
    return app


app = create_app()
