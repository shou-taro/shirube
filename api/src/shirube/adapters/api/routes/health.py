"""Health-check endpoint."""

from fastapi import APIRouter
from pydantic import BaseModel

from shirube import __version__

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """Response body for the health check.

    Attributes:
        status: Always ``"ok"`` when the server can answer.
        version: The running Shirube version, handy for confirming what is deployed.
    """

    status: str
    version: str


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Report that the API is up.

    Used by the frontend on load to confirm it can reach the backend, and by any
    external liveness probe.

    Returns:
        A :class:`HealthResponse` with status ``"ok"`` and the running version.
    """
    return HealthResponse(status="ok", version=__version__)
