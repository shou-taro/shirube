"""FastAPI application factory (a driving adapter).

This is the HTTP entry point into the application core. In a packaged build it also
serves the compiled single-page app, so the whole tool runs from one process on one
origin; in development the Vite dev server serves the UI and proxies API calls here.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from shirube import __version__
from shirube.adapters.api.errors import register_exception_handlers
from shirube.adapters.api.routes import connections, data, health, profiles, schema
from shirube.adapters.persistence.bootstrap import bootstrap_database

# The built SPA, copied here by scripts/build.sh and bundled into the wheel. It is
# absent during development (git-ignored), where Vite serves the UI instead — hence the
# existence check in create_app().
STATIC_DIR = Path(__file__).resolve().parents[2] / "static"


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
