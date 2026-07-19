"""Domain types for the AI navigator's provider configuration (Milestone 2).

shirube talks to at most one AI provider at a time, configured once and shared across every
connection profile. Two adapter kinds cover the field: the Anthropic-native API (Claude —
the recommended default) and any OpenAI-compatible endpoint (OpenAI itself, a gateway, or a
local runner such as Ollama). The choice of provider, not a default, is what turns the
navigator on.

These are the non-secret settings only. The API key — when the provider needs one — is a
secret and lives in the OS keychain, never here (see the AI config service).
"""

from dataclasses import dataclass
from enum import StrEnum


class AiProviderKind(StrEnum):
    """Which adapter talks to the configured provider.

    ``OPENAI_COMPATIBLE`` deliberately covers OpenAI, gateways and local runners alike —
    they all speak the OpenAI chat-completions shape, so one adapter reaches every one and
    Ollama needs no adapter of its own.
    """

    ANTHROPIC = "anthropic"
    OPENAI_COMPATIBLE = "openai_compatible"


@dataclass(frozen=True, slots=True)
class AiProviderConfig:
    """The app-wide AI provider configuration — non-secret fields only.

    Attributes:
        kind: Which adapter to use (Anthropic-native or OpenAI-compatible).
        model: The model name to request (e.g. ``claude-opus-4-8``, ``gpt-4o``,
            ``llama3.1``).
        base_url: Where to reach the API. Required for an OpenAI-compatible provider —
            there is no single default endpoint — and optional for Anthropic, whose adapter
            defaults to the Claude API when this is ``None``.
    """

    kind: AiProviderKind
    model: str
    base_url: str | None = None
