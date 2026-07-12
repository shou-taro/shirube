"""FastAPI application factory (a driving adapter)."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from shirube import __version__
from shirube.adapters.api.errors import register_exception_handlers
from shirube.adapters.api.routes import health
from shirube.adapters.persistence.bootstrap import bootstrap_database

# The built SPA, bundled into the package at build time (see scripts/build.sh).
# Absent during development, where the Vite dev server serves the UI instead.
STATIC_DIR = Path(__file__).resolve().parents[2] / "static"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    bootstrap_database()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Shirube", version=__version__, lifespan=lifespan)
    register_exception_handlers(app)
    app.include_router(health.router, prefix="/api")
    if STATIC_DIR.is_dir():
        # Serve the SPA on the same origin as the API once it has been bundled.
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="spa")
    return app


app = create_app()
