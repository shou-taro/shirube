"""Context-window budgeting for the AI navigator (Milestone 2 — AI navigator).

A conversation, and even a single answer's accumulating tool results, must fit inside the
model's context window. Rather than count tokens exactly — which would need a per-provider
tokeniser and, for hosted models, a network round-trip — this module estimates tokens from
character counts and trims the oldest history to fit. The estimate is deliberately
*conservative* (it never undercounts), so the trimmed prompt stays inside the window rather
than overflowing it and failing the request.

The window itself comes from the provider configuration:

- **Anthropic (Claude)** — the window is known to be large, so a generous constant is used and
  no configuration is needed.
- **OpenAI-compatible** — the kind spans hosted OpenAI (large) and local runners such as
  Ollama (often only a few thousand tokens, and configurable per model), so the window is a
  user-supplied setting with a conservative default.

From the window, a fixed share is reserved for the answer the model will generate and for the
look-up results that accumulate within a turn; whatever remains is the budget the prior
history is trimmed to fit.
"""

import json
import math
from collections.abc import Sequence

from shirube.domain.ai import AiProviderConfig, AiProviderKind
from shirube.domain.chat import TurnMessage

# Claude's context window is large on every current model; a conservative constant avoids
# any need to configure it, and leaves the trimming maths a comfortable ceiling to work under.
ANTHROPIC_CONTEXT_WINDOW = 200_000

# A safe default for an unconfigured OpenAI-compatible provider: it matches Ollama's own
# default ``num_ctx`` (4096), so a local model works out of the box. A user running a
# larger-window model raises it in the settings.
DEFAULT_OPENAI_CONTEXT_WINDOW = 4096

# The most tokens ever reserved for the model's answer. Navigator replies are concise, so a
# modest cap is plenty; on a small window it shrinks further (see :func:`output_reserve_for`).
MAX_OUTPUT_RESERVE = 1024

# A rough allowance per message for the role/framing tokens the estimate can't see in the
# text itself.
_PER_MESSAGE_OVERHEAD = 4


def estimate_tokens(text: str) -> int:
    """Estimate the token count of ``text``, erring on the high side.

    ASCII text runs at roughly four characters per token, but CJK and other multi-byte
    scripts sit closer to one token per character. Counting the wide characters at full
    weight keeps the estimate at or above the real count, so trimming never leaves the prompt
    over the window.

    Args:
        text: The text to estimate.

    Returns:
        An estimated, conservative token count.
    """
    ascii_chars = sum(1 for char in text if char.isascii())
    wide_chars = len(text) - ascii_chars
    return math.ceil(ascii_chars / 4) + wide_chars


def estimate_messages(messages: Sequence[TurnMessage]) -> int:
    """Estimate the total token count of a sequence of turn messages.

    Counts each message's text plus, for an assistant message that requested tool calls, the
    name and serialised arguments of each call — the tool traffic that accumulates within a
    turn and drives the prompt towards the window.
    """
    total = 0
    for message in messages:
        total += _PER_MESSAGE_OVERHEAD + estimate_tokens(message.content)
        for call in message.tool_calls:
            total += estimate_tokens(call.name) + estimate_tokens(json.dumps(call.arguments))
    return total


def resolve_window(config: AiProviderConfig) -> int:
    """Return the context window to budget against for a provider configuration.

    Anthropic uses the known-large constant; an OpenAI-compatible provider uses its
    configured window, falling back to the conservative default when unset.
    """
    if config.kind is AiProviderKind.ANTHROPIC:
        return ANTHROPIC_CONTEXT_WINDOW
    return config.context_window or DEFAULT_OPENAI_CONTEXT_WINDOW


def output_reserve_for(window: int) -> int:
    """Tokens to hold back for the model's answer, scaled to the window.

    Capped at :data:`MAX_OUTPUT_RESERVE`, but never more than a quarter of a small window, so
    a narrow context still leaves room for the prompt.
    """
    return min(MAX_OUTPUT_RESERVE, window // 4)


def tool_reserve_for(window: int) -> int:
    """Tokens to hold back for the look-up results that accumulate within a turn."""
    return window // 4


def trim_history(messages: Sequence[TurnMessage], budget: int) -> list[TurnMessage]:
    """Drop the oldest messages until the history fits ``budget``.

    The most recent message — the user's current question — is always kept, even if it alone
    exceeds the budget (the caller's per-turn ceiling check catches that case and ends the
    turn cleanly). Older messages are dropped oldest-first.

    Args:
        messages: The conversation so far, oldest first, ending with the current question.
        budget: The token budget the retained history must fit within.

    Returns:
        The retained messages, in their original order.
    """
    kept = list(messages)
    while len(kept) > 1 and estimate_messages(kept) > budget:
        kept.pop(0)
    return kept
