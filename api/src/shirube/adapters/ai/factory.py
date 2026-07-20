"""Build the right AI provider adapter from the stored configuration (Milestone 2).

Keeps the choice of concrete adapter at the edge: the application layer depends on the
:class:`~shirube.ports.repositories.AiProvider` port, and this factory turns a stored
:class:`~shirube.domain.ai.AiProviderConfig` plus its keychain key into the matching adapter.
"""

from shirube.adapters.ai.anthropic_provider import AnthropicProvider
from shirube.adapters.ai.openai_provider import OpenAiCompatibleProvider
from shirube.domain.ai import AiProviderConfig, AiProviderKind
from shirube.domain.errors import InvalidProviderConfigError
from shirube.ports.repositories import AiProvider


def build_provider(config: AiProviderConfig, api_key: str | None) -> AiProvider:
    """Construct the provider adapter for a configuration.

    Args:
        config: The configured provider (kind, model, base URL).
        api_key: The API key from the keychain, or ``None`` for a keyless local provider.

    Returns:
        The matching :class:`AiProvider` adapter.

    Raises:
        InvalidProviderConfigError: if an OpenAI-compatible provider has no base URL (there is
            no default endpoint to fall back to).
    """
    if config.kind is AiProviderKind.ANTHROPIC:
        return AnthropicProvider(model=config.model, api_key=api_key, base_url=config.base_url)

    if not config.base_url:
        raise InvalidProviderConfigError("An OpenAI-compatible provider needs a base URL.")
    return OpenAiCompatibleProvider(model=config.model, base_url=config.base_url, api_key=api_key)
