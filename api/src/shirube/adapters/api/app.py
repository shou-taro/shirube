"""FastAPI application factory (a driving adapter)."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from shirube import __version__
from shirube.adapters.api.errors import register_exception_handlers
from shirube.adapters.api.routes import health
from shirube.adapters.persistence.bootstrap import bootstrap_database


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    bootstrap_database()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Shirube", version=__version__, lifespan=lifespan)
    register_exception_handlers(app)
    app.include_router(health.router, prefix="/api")
    return app


app = create_app()
