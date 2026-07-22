"""AI provider configuration endpoints (Milestone 2 — AI navigator).

The app-wide provider is configured here: which adapter, which model, where to reach it,
and — separately and secretly — its API key. Responses never include the key; they report
only whether one is stored, exactly as the profile endpoints never return a password.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from shirube.adapters.ai.factory import check_provider
from shirube.adapters.api.dependencies import get_ai_config_service, get_secret_store
from shirube.application.ai_config import AI_PROVIDER_SECRET_ID, AiConfigService, ProviderStatus
from shirube.domain.ai import AiProviderConfig, AiProviderKind
from shirube.ports.repositories import SecretStore

router = APIRouter(prefix="/ai", tags=["ai"])


class AiProviderRead(BaseModel):
    """The configured AI provider as returned to the client — never the API key."""

    kind: AiProviderKind
    model: str
    base_url: str | None
    context_window: int | None
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
            context_window=status.config.context_window,
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
    context_window: int | None = None
    api_key: str | None = None

    def to_config(self) -> AiProviderConfig:
        """Extract the non-secret provider settings."""
        return AiProviderConfig(
            kind=self.kind,
            model=self.model,
            base_url=self.base_url,
            context_window=self.context_window,
        )


class ProviderTestResult(BaseModel):
    """The result of a successful provider connection check."""

    ok: bool = True


ServiceDep = Annotated[AiConfigService, Depends(get_ai_config_service)]
SecretsDep = Annotated[SecretStore, Depends(get_secret_store)]


@router.get("/provider", response_model=AiProviderRead | None)
def get_provider(service: ServiceDep) -> AiProviderRead | None:
    """Return the configured AI provider, or ``null`` when none is set."""
    return AiProviderRead.from_status(service.get())


@router.put("/provider", response_model=AiProviderRead)
def set_provider(body: AiProviderWrite, service: ServiceDep) -> AiProviderRead | None:
    """Configure the AI provider; the API key is replaced only when one is supplied."""
    return AiProviderRead.from_status(service.set(body.to_config(), body.api_key))


@router.post("/provider/test", response_model=ProviderTestResult)
def test_provider(body: AiProviderWrite, secrets: SecretsDep) -> ProviderTestResult:
    """Check that a provider configuration can be reached and authenticated.

    Uses the supplied API key, or the stored one when none is given — so a saved provider
    can be re-checked without re-entering its key. Returns ``{"ok": true}`` on success; a
    failure surfaces as a 400 with a translated, actionable message.
    """
    api_key = body.api_key or secrets.get_password(AI_PROVIDER_SECRET_ID)
    check_provider(body.to_config(), api_key)
    return ProviderTestResult()


@router.delete("/provider", status_code=status.HTTP_204_NO_CONTENT)
def delete_provider(service: ServiceDep) -> None:
    """Unconfigure the AI provider and remove any stored API key."""
    service.delete()
