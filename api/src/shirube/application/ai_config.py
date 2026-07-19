"""Use cases for the app-wide AI provider configuration (Milestone 2 — AI navigator).

Coordinates the config repository (non-secret fields: adapter kind, model, base URL) and
the secret store (the API key) so the two never drift apart — mirroring how
:class:`~shirube.application.profiles.ProfileService` pairs a profile with its keychain
password. Configuring a provider is the user's deliberate choice; nothing is set until they
set it, and clearing it removes both the config and any stored key.
"""

from dataclasses import dataclass

from shirube.domain.ai import AiProviderConfig, AiProviderKind
from shirube.domain.errors import InvalidProviderConfigError
from shirube.ports.repositories import AiConfigRepository, SecretStore

# Reserved keychain id for the AI provider's API key. Connection-profile passwords are keyed
# by UUID, so this fixed sentinel can never collide with one — a single app-wide key sits
# alongside the per-profile passwords under the same ``shirube`` keychain service.
AI_PROVIDER_SECRET_ID = "ai-provider"  # nosec B105  (a keychain key name, not a password)


@dataclass(frozen=True, slots=True)
class ProviderStatus:
    """The current provider configuration as reported to the client.

    Attributes:
        config: The configured provider, or ``None`` if none is set.
        has_api_key: Whether an API key is stored in the keychain. The key itself is never
            exposed — only whether one is present, so the UI can show "stored" without ever
            handling the secret.
    """

    config: AiProviderConfig | None
    has_api_key: bool


class AiConfigService:
    """Reads, writes and clears the app-wide AI provider configuration."""

    def __init__(self, repository: AiConfigRepository, secrets: SecretStore) -> None:
        self._repository = repository
        self._secrets = secrets

    def get(self) -> ProviderStatus:
        """Return the configured provider and whether an API key is stored."""
        config = self._repository.get()
        has_api_key = self._secrets.get_password(AI_PROVIDER_SECRET_ID) is not None
        return ProviderStatus(config=config, has_api_key=has_api_key)

    def set(self, config: AiProviderConfig, api_key: str | None) -> ProviderStatus:
        """Store the provider config, and its API key when one is supplied.

        A ``None`` ``api_key`` leaves any stored key untouched (so the client need not
        re-send it on every edit); a non-empty string replaces it. If storing the key fails
        and there was no provider configured before, the just-written config is rolled back,
        so a failure never leaves a provider saved without the key it needs.

        Args:
            config: The non-secret provider settings to store.
            api_key: The API key to store, or ``None`` to keep the existing one.

        Returns:
            The resulting provider status.

        Raises:
            InvalidProviderConfigError: if the config is incomplete or inconsistent.
            SecretStoreError: if the API key cannot be written to the keychain.
        """
        self._validate(config)
        previous = self._repository.get()
        self._repository.set(config)
        if api_key:
            try:
                self._secrets.set_password(AI_PROVIDER_SECRET_ID, api_key)
            except Exception:
                # Undo the write so config and key never drift — but only when there was no
                # provider before, to avoid discarding a working prior configuration.
                if previous is None:
                    self._repository.clear()
                else:
                    self._repository.set(previous)
                raise
        return self.get()

    def delete(self) -> None:
        """Unconfigure the provider: remove the config and any stored API key."""
        self._repository.clear()
        self._secrets.delete_password(AI_PROVIDER_SECRET_ID)

    @staticmethod
    def _validate(config: AiProviderConfig) -> None:
        """Reject an incomplete or inconsistent config before anything is stored."""
        if config.model.strip() == "":
            raise InvalidProviderConfigError("Enter the model name for the AI provider.")
        if config.kind is AiProviderKind.OPENAI_COMPATIBLE and not (config.base_url or "").strip():
            raise InvalidProviderConfigError(
                "An OpenAI-compatible provider needs a base URL (e.g. "
                "http://localhost:11434/v1 for a local Ollama, or the provider's API URL)."
            )
