"""AI provider configuration endpoints (Milestone 2 — AI navigator).

The app-wide provider is configured here: which adapter, which model, where to reach it,
and — separately and secretly — its API key. Responses never include the key; they report
only whether one is stored, exactly as the profile endpoints never return a password.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from shirube.adapters.api.dependencies import get_ai_config_service
from shirube.application.ai_config import AiConfigService, ProviderStatus
from shirube.domain.ai import AiProviderConfig, AiProviderKind

router = APIRouter(prefix="/ai", tags=["ai"])


class AiProviderRead(BaseModel):
    """The configured AI provider as returned to the client — never the API key."""

    kind: AiProviderKind
    model: str
    base_url: str | None
    has_api_key: bool

    @classmethod
    def from_status(cls, status: ProviderStatus) -> "AiProviderRead | None":
        """Build the response from a provider status, or ``None`` when unconfigured."""
        if status.config is None:
            return None
        return cls(
            kind=status.config.kind,
            model=status.config.model,
            base_url=status.config.base_url,
            has_api_key=status.has_api_key,
        )


class AiProviderWrite(BaseModel):
    """Request body for configuring the AI provider.

    A missing or null ``api_key`` leaves any stored key unchanged; a non-empty string
    replaces it. Local providers (e.g. Ollama) need no key, so it may be omitted entirely.
    """

    kind: AiProviderKind
    model: str
    base_url: str | None = None
    api_key: str | None = None

    def to_config(self) -> AiProviderConfig:
        """Extract the non-secret provider settings."""
        return AiProviderConfig(kind=self.kind, model=self.model, base_url=self.base_url)


ServiceDep = Annotated[AiConfigService, Depends(get_ai_config_service)]


@router.get("/provider", response_model=AiProviderRead | None)
def get_provider(service: ServiceDep) -> AiProviderRead | None:
    """Return the configured AI provider, or ``null`` when none is set."""
    return AiProviderRead.from_status(service.get())


@router.put("/provider", response_model=AiProviderRead)
def set_provider(body: AiProviderWrite, service: ServiceDep) -> AiProviderRead | None:
    """Configure the AI provider; the API key is replaced only when one is supplied."""
    return AiProviderRead.from_status(service.set(body.to_config(), body.api_key))


@router.delete("/provider", status_code=status.HTTP_204_NO_CONTENT)
def delete_provider(service: ServiceDep) -> None:
    """Unconfigure the AI provider and remove any stored API key."""
    service.delete()
