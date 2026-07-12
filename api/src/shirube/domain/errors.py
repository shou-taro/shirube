"""Base error types shared across the domain and application layers."""


class ShirubeError(Exception):
    """Base class for expected Shirube errors surfaced to the API."""

    status_code: int = 400
    detail: str = "The request could not be processed"
