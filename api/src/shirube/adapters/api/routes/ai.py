"""AI provider configuration endpoints (Milestone 2 — AI navigator).

The app-wide provider is configured here: which adapter, which model, where to reach it,
and — separately and secretly — its API key. Responses never include the key; they report
only whether one is stored, exactly as the profile endpoints never return a password.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from shirube.adapters.ai.factory import check_provider, list_provider_models
from shirube.adapters.api.dependencies import get_ai_config_service
from shirube.application.ai_config import AiConfigService, ProviderStatus
from shirube.domain.ai import AiProviderConfig, AiProviderKind

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


class ProviderModelsResult(BaseModel):
    """The model ids a provider offers, for the settings form's model picker."""

    models: list[str]


ServiceDep = Annotated[AiConfigService, Depends(get_ai_config_service)]


@router.get("/provider", response_model=AiProviderRead | None)
def get_provider(service: ServiceDep) -> AiProviderRead | None:
    """Return the configured AI provider, or ``null`` when none is set."""
    return AiProviderRead.from_status(service.get())


@router.put("/provider", response_model=AiProviderRead)
def set_provider(body: AiProviderWrite, service: ServiceDep) -> AiProviderRead | None:
    """Configure the AI provider; the API key is replaced only when one is supplied."""
    return AiProviderRead.from_status(service.set(body.to_config(), body.api_key))


@router.post("/provider/test", response_model=ProviderTestResult)
def test_provider(body: AiProviderWrite, service: ServiceDep) -> ProviderTestResult:
    """Check that a provider configuration can be reached and authenticated.

    Uses the supplied API key, or the stored one when none is given *and the destination is
    unchanged* — so a saved provider can be re-checked without re-entering its key, but a key
    saved for one provider is never sent to a different endpoint the user has just typed in.
    Returns ``{"ok": true}`` on success; a failure surfaces as a 400 with a translated,
    actionable message.
    """
    config = body.to_config()
    check_provider(config, service.resolve_api_key(config, body.api_key))
    return ProviderTestResult()


@router.post("/provider/models", response_model=ProviderModelsResult)
def get_provider_models(body: AiProviderWrite, service: ServiceDep) -> ProviderModelsResult:
    """List the models the entered (or configured) provider offers.

    Resolves the API key exactly as the test endpoint does — the supplied key, or the stored
    one only when the destination is unchanged — so a key saved for one provider is never sent
    to a different endpoint just to list its models. Sends no schema; only model names are read
    back, so it does not change what leaves the machine. A provider that cannot be reached or
    list its models fails with a 4xx and a translated message, and the form falls back to
    free-text entry.
    """
    config = body.to_config()
    return ProviderModelsResult(
        models=list_provider_models(config, service.resolve_api_key(config, body.api_key))
    )


@router.delete("/provider", status_code=status.HTTP_204_NO_CONTENT)
def delete_provider(service: ServiceDep) -> None:
    """Unconfigure the AI provider and remove any stored API key."""
    service.delete()
