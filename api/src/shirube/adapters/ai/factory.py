"""Build the right AI provider adapter from the stored configuration (Milestone 2).

Keeps the choice of concrete adapter at the edge: the application layer depends on the
:class:`~shirube.ports.repositories.AiProvider` port, and this factory turns a stored
:class:`~shirube.domain.ai.AiProviderConfig` plus its keychain key into the matching adapter.
"""

from shirube.adapters.ai.anthropic_provider import AnthropicProvider
from shirube.adapters.ai.openai_provider import OpenAiCompatibleProvider
from shirube.application.context_budget import output_reserve_for, resolve_window
from shirube.domain.ai import AiProviderConfig, AiProviderKind
from shirube.domain.errors import InvalidProviderConfigError, ProviderCheckError
from shirube.ports.repositories import AiProvider


def build_provider(config: AiProviderConfig, api_key: str | None) -> AiProvider:
    """Construct the provider adapter for a configuration.

    Args:
        config: The configured provider (kind, model, base URL, context window).
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
    # Cap the answer to the window's output reserve, so the reply cannot push a small local
    # model's prompt-plus-answer past its context window.
    return OpenAiCompatibleProvider(
        model=config.model,
        base_url=config.base_url,
        api_key=api_key,
        max_tokens=output_reserve_for(resolve_window(config)),
    )


def check_provider(
    config: AiProviderConfig,
    api_key: str | None,
) -> None:
    """Verify a provider configuration can be reached and authenticated.

    Builds the matching adapter and performs its cheap, token-free connection check, so a
    wrong endpoint or a rejected key is caught before the configuration is saved.

    Args:
        config: The provider to check (kind, model, base URL).
        api_key: The API key to authenticate with, or ``None`` for a keyless local provider.

    Raises:
        ProviderCheckError: if the provider cannot be reached or the key is rejected — or, for
            Claude, if no API key was supplied (it has no keyless mode to fall back on).
        InvalidProviderConfigError: if an OpenAI-compatible provider has no base URL.
    """
    if config.kind is AiProviderKind.ANTHROPIC:
        if not api_key:
            raise ProviderCheckError("The Claude provider needs an API key.")
        AnthropicProvider(model=config.model, api_key=api_key, base_url=config.base_url).check()
        return

    if not config.base_url:
        raise InvalidProviderConfigError("An OpenAI-compatible provider needs a base URL.")
    OpenAiCompatibleProvider(model=config.model, base_url=config.base_url, api_key=api_key).check()
