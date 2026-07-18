"""FastAPI application factory (a driving adapter).

This is the HTTP entry point into the application core. In a packaged build it also
serves the compiled single-page app, so the whole tool runs from one process on one
origin; in development the Vite dev server serves the UI and proxies API calls here.
"""

import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from shirube import __version__
from shirube.adapters.api.errors import register_exception_handlers
from shirube.adapters.api.routes import connections, data, health, profiles, schema
from shirube.adapters.persistence.bootstrap import bootstrap_database
from shirube.config import get_settings
from shirube.logging_config import get_logger

# The built SPA, copied here by scripts/build.sh and bundled into the wheel. It is
# absent during development (git-ignored), where Vite serves the UI instead — hence the
# existence check in create_app().
STATIC_DIR = Path(__file__).resolve().parents[2] / "static"

_logger = get_logger("shirube.request")

# A conservative Content-Security-Policy for the bundled SPA. Everything is same-origin
# (scripts, styles, the API), so only 'self' is allowed; inline styles are permitted
# because React Flow sets element style attributes, and data: covers the inline SVG
# favicon and logo. frame-ancestors 'none' blocks the page being framed (clickjacking).
_CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


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
    async def _security_headers(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Add defence-in-depth security headers to every response.

        Cheap hardening for a locally served app: stop MIME sniffing, forbid framing
        (clickjacking), withhold the referrer, and constrain resource loading to the
        same origin via a Content-Security-Policy.
        """
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = _CONTENT_SECURITY_POLICY
        return response

    @app.middleware("http")
    async def _log_requests(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Log each request's outcome — method, path, status and duration.

        A short ``request_id`` is bound for the lifetime of the request and attached to
        every event logged while it runs (here and in the error handler), so the lines
        belonging to one request can be tied together; it is also returned to the caller
        in the ``X-Request-ID`` header. Only metadata is recorded: never the query string,
        request body or response content, so filter values and row data stay out of the
        log. An exception that escapes the handlers (a genuine bug) is logged with its
        traceback and re-raised for FastAPI's default 500.
        """
        request_id = uuid4().hex[:12]
        structlog.contextvars.bind_contextvars(request_id=request_id)
        start = time.perf_counter()
        try:
            response = await call_next(request)
            elapsed_ms = (time.perf_counter() - start) * 1000
            _logger.info(
                "request",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                duration_ms=round(elapsed_ms),
            )
            response.headers["X-Request-ID"] = request_id
            return response
        except Exception:
            elapsed_ms = (time.perf_counter() - start) * 1000
            _logger.exception(
                "request_failed",
                method=request.method,
                path=request.url.path,
                duration_ms=round(elapsed_ms),
            )
            raise
        finally:
            # Always clear the request-scoped context so it never bleeds into the next
            # request handled on this task.
            structlog.contextvars.unbind_contextvars("request_id")

    # Reject requests whose Host header is not a name we serve, added last so it runs
    # outermost — a bad host is refused before any handler or logging runs. This is the
    # core DNS-rebinding defence: it stops a page on another origin from reaching this
    # local API by pointing its own hostname at 127.0.0.1. The bind host is always
    # allowed alongside the configured names.
    settings = get_settings()
    allowed_hosts = list(dict.fromkeys([*settings.allowed_hosts, settings.host]))
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)

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
