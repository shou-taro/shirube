"""Tests for the AI navigator's context-window budgeting.

Covers the pure pieces — the conservative token estimate, the per-provider window
resolution, the scaled reserves, and the oldest-first history trimming — that keep the
navigator's prompt inside a model's context window.
"""

from shirube.application.context_budget import (
    ANTHROPIC_CONTEXT_WINDOW,
    DEFAULT_OPENAI_CONTEXT_WINDOW,
    MAX_OUTPUT_RESERVE,
    estimate_tokens,
    output_reserve_for,
    resolve_window,
    tool_reserve_for,
    trim_history,
)
from shirube.domain.ai import AiProviderConfig, AiProviderKind
from shirube.domain.chat import ChatRole, TurnMessage


def test_estimate_counts_wide_characters_at_full_weight() -> None:
    # ASCII runs ~4 chars/token; CJK sits near 1 token/char, so it must weigh more. The
    # estimate never undercounts, which is what keeps a trimmed prompt inside the window.
    assert estimate_tokens("aaaa") == 1
    japanese = "データベース"  # 6 wide characters
    assert estimate_tokens(japanese) == len(japanese)
    assert estimate_tokens(japanese) > estimate_tokens("a" * len(japanese))


def test_resolve_window_uses_the_large_constant_for_anthropic() -> None:
    config = AiProviderConfig(kind=AiProviderKind.ANTHROPIC, model="claude-opus-4-8")
    assert resolve_window(config) == ANTHROPIC_CONTEXT_WINDOW


def test_resolve_window_uses_the_configured_window_for_openai_compatible() -> None:
    configured = AiProviderConfig(
        kind=AiProviderKind.OPENAI_COMPATIBLE,
        model="llama3.1",
        base_url="http://localhost:11434/v1",
        context_window=32768,
    )
    assert resolve_window(configured) == 32768


def test_resolve_window_falls_back_to_the_default_when_unset() -> None:
    unset = AiProviderConfig(
        kind=AiProviderKind.OPENAI_COMPATIBLE,
        model="llama3.1",
        base_url="http://localhost:11434/v1",
    )
    assert resolve_window(unset) == DEFAULT_OPENAI_CONTEXT_WINDOW


def test_output_reserve_is_capped_but_shrinks_on_a_small_window() -> None:
    assert output_reserve_for(1_000_000) == MAX_OUTPUT_RESERVE
    assert output_reserve_for(2048) == 512  # a quarter, well under the cap


def test_tool_reserve_is_a_quarter_of_the_window() -> None:
    assert tool_reserve_for(8192) == 2048


def _msg(role: ChatRole, content: str) -> TurnMessage:
    return TurnMessage(role=role, content=content)


def test_trim_drops_oldest_first_until_it_fits() -> None:
    messages = [
        _msg(ChatRole.USER, "a" * 4000),  # ~1000 tokens
        _msg(ChatRole.ASSISTANT, "b" * 4000),  # ~1000 tokens
        _msg(ChatRole.USER, "current"),
    ]
    kept = trim_history(messages, budget=1200)

    # The oldest is dropped to fit; the current question is always retained.
    contents = [message.content for message in kept]
    assert "a" * 4000 not in contents
    assert "current" in contents


def test_trim_keeps_the_last_message_even_when_it_alone_exceeds_the_budget() -> None:
    messages = [_msg(ChatRole.USER, "x" * 8000)]
    kept = trim_history(messages, budget=10)
    assert len(kept) == 1  # the caller's ceiling check handles this case


def test_trim_leaves_a_fitting_history_untouched() -> None:
    messages = [_msg(ChatRole.USER, "hi"), _msg(ChatRole.ASSISTANT, "hello")]
    assert trim_history(messages, budget=100_000) == messages
