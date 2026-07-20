"""AI provider adapters — the concrete engines behind the AI navigator (Milestone 2).

Each adapter implements :class:`~shirube.ports.repositories.AiProvider`, translating the
provider-neutral :class:`~shirube.domain.chat.TurnRequest` into its SDK's streaming call and
yielding back the neutral events. Two cover the field:
:class:`~shirube.adapters.ai.anthropic_provider.AnthropicProvider` (Claude, native) and
:class:`~shirube.adapters.ai.openai_provider.OpenAiCompatibleProvider` (OpenAI, Ollama and
any OpenAI-compatible endpoint).
"""
