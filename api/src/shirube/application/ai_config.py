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


def _normalise_base_url(base_url: str | None) -> str:
    """Reduce a base URL for destination comparison.

    Only a trailing slash is ignored; any difference in scheme, host, port or path makes it a
    different destination (and so a different place a key would be sent).
    """
    return (base_url or "").rstrip("/")


def _same_destination(a: AiProviderConfig, b: AiProviderConfig) -> bool:
    """Whether two configs point at the same place a key would be sent.

    The same adapter kind and the same (normalised) base URL — the model may differ, but the
    destination may not. This is the test that decides whether a stored key may be reused.
    """
    return a.kind is b.kind and _normalise_base_url(a.base_url) == _normalise_base_url(b.base_url)


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

    def resolve_api_key(self, config: AiProviderConfig, supplied_key: str | None) -> str | None:
        """Choose the API key to authenticate ``config`` with, without leaking a stored one.

        A supplied (non-empty) key always wins. Otherwise the stored key is reused **only** when
        ``config`` points at the same destination as the currently-stored provider — same kind
        and base URL — so a key saved for one provider is never sent to a different endpoint the
        user has since entered (e.g. switching a saved Claude to a custom OpenAI-compatible URL
        and listing its models). A changed destination with no key supplied authenticates with
        none.

        This is the single place that decides key reuse, shared by saving, the connection test
        and the model listing, so the rule cannot drift between them.

        Args:
            config: The provider a request means to reach.
            supplied_key: A key sent with the request, or ``None`` / ``""`` to fall back to the
                stored one.

        Returns:
            The key to authenticate with, or ``None`` when none applies.
        """
        if supplied_key:
            return supplied_key
        stored = self._repository.get()
        if stored is not None and _same_destination(stored, config):
            return self._secrets.get_password(AI_PROVIDER_SECRET_ID)
        return None

    def set(self, config: AiProviderConfig, api_key: str | None) -> ProviderStatus:
        """Store the provider config, and its API key when one is supplied.

        A supplied key replaces the stored one. A ``None`` key keeps the stored key **only when
        the destination is unchanged** (same kind and base URL) — so an edit that just renames
        the model need not re-send it. When the destination changes and no new key is supplied,
        the stored key belonged to the *old* destination, so it is removed rather than left
        paired with the new one. If a keychain write fails, the config write is rolled back so
        config and key never drift.

        Args:
            config: The non-secret provider settings to store.
            api_key: The API key to store, or ``None`` to keep the existing one (same
                destination only).

        Returns:
            The resulting provider status.

        Raises:
            InvalidProviderConfigError: if the config is incomplete or inconsistent, or a
                Claude provider would be left without a key.
            SecretStoreError: if the API key cannot be written to (or removed from) the keychain.
        """
        self._validate(config)
        previous = self._repository.get()
        same_destination = previous is not None and _same_destination(previous, config)
        # The stored key belongs to the previous destination; it only carries over when the
        # destination is unchanged. A supplied key always wins.
        effective_key = api_key or (
            self._secrets.get_password(AI_PROVIDER_SECRET_ID) if same_destination else None
        )
        # Claude talks to the hosted Claude API, so it always needs a key — supplied now or
        # already stored *for this destination*. Checked before writing so a keyless Claude
        # provider is never saved, and so a key stored for a different provider cannot stand in.
        if config.kind is AiProviderKind.ANTHROPIC and not effective_key:
            raise InvalidProviderConfigError(
                "Claude needs an API key — enter your Anthropic API key."
            )
        self._repository.set(config)
        try:
            if api_key:
                self._secrets.set_password(AI_PROVIDER_SECRET_ID, api_key)
            elif not same_destination:
                # Destination changed with no new key: drop the old key so it cannot linger
                # paired with — and later be sent to — the new destination.
                self._secrets.delete_password(AI_PROVIDER_SECRET_ID)
        except Exception:
            # Undo the config write so config and key never drift: restore the prior config, or
            # clear it when there was none.
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
