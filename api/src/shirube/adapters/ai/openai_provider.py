"""OpenAI-compatible provider adapter (Milestone 2 — AI navigator).

Talks to any endpoint that speaks the OpenAI chat-completions API — OpenAI itself, a gateway,
or a local runner such as Ollama — via the ``openai`` SDK pointed at the configured base URL.
One adapter reaches them all, which is why Ollama needs none of its own.

The translation to and from the OpenAI wire shapes is factored into pure module functions so
it can be unit-tested without a network; the class just wires them to the SDK's streaming
call.
"""

import json
from collections.abc import Iterable, Iterator
from typing import Any
from urllib.parse import urlparse

from openai import APIConnectionError, APIError, AuthenticationError, BadRequestError, OpenAI

from shirube.domain.chat import (
    ChatRole,
    ProviderEvent,
    TextDelta,
    TokenUsage,
    ToolDefinition,
    ToolUse,
    TurnComplete,
    TurnRequest,
)
from shirube.domain.errors import (
    ProviderCheckError,
    ProviderRequestError,
    provider_error_reason,
)

# The openai SDK requires a non-empty API key even for a local, keyless endpoint; this
# placeholder is sent when the provider needs no key (e.g. Ollama).
_NO_KEY_PLACEHOLDER = "not-needed"  # nosec B105  (a placeholder, not a real credential)

# The OpenAI platform's own host. Its reasoning models (the o-series and the GPT-5 family)
# reject the legacy ``max_tokens`` and accept only ``max_completion_tokens``, which every
# current OpenAI model understands; other OpenAI-compatible servers (Ollama, many gateways)
# only know ``max_tokens``.
_OPENAI_PLATFORM_HOST = "api.openai.com"
_LEGACY_TOKEN_PARAM = "max_tokens"  # nosec B105  (a parameter name, not a credential)
_TOKEN_PARAM = "max_completion_tokens"  # nosec B105  (a parameter name, not a credential)


def is_openai_platform(base_url: str | None) -> bool:
    """Whether ``base_url`` points at the OpenAI platform itself rather than a lookalike."""
    return bool(base_url) and urlparse(base_url).hostname == _OPENAI_PLATFORM_HOST


def _rejects_legacy_token_param(exc: BadRequestError) -> bool:
    """Whether a 400 is the endpoint refusing ``max_tokens`` in favour of the newer name."""
    return getattr(exc, "param", None) == _LEGACY_TOKEN_PARAM or _TOKEN_PARAM in str(exc)


def to_openai_messages(request: TurnRequest) -> list[dict[str, Any]]:
    """Translate a neutral turn into the OpenAI ``messages`` list."""
    messages: list[dict[str, Any]] = [{"role": "system", "content": request.system}]
    for message in request.messages:
        if message.role is ChatRole.USER:
            messages.append({"role": "user", "content": message.content})
        elif message.role is ChatRole.ASSISTANT:
            assistant: dict[str, Any] = {"role": "assistant", "content": message.content or None}
            if message.tool_calls:
                assistant["tool_calls"] = [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {"name": call.name, "arguments": json.dumps(call.arguments)},
                    }
                    for call in message.tool_calls
                ]
            messages.append(assistant)
        elif message.role is ChatRole.TOOL:
            messages.append(
                {"role": "tool", "tool_call_id": message.tool_call_id, "content": message.content}
            )
    return messages


def to_openai_tools(tools: Iterable[ToolDefinition]) -> list[dict[str, Any]]:
    """Translate the neutral tool definitions into OpenAI ``tools`` entries."""
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }
        for tool in tools
    ]


# OpenAI finish reasons mapped onto the neutral stop reasons; ``length`` is the output cap
# being hit, which a reasoning model can do before writing any visible text at all.
_STOP_REASONS = {"tool_calls": "tool_use", "length": "max_tokens"}


def parse_openai_stream(chunks: Iterable[Any]) -> Iterator[ProviderEvent]:
    """Turn an OpenAI streamed completion into neutral provider events.

    Text arrives as deltas (relayed straight through). Tool calls arrive fragmented — an
    ``index`` with the id, name and ``arguments`` string dribbled across chunks — so they are
    accumulated per index and emitted as one :class:`ToolUse` each once the stream ends, after
    the final :class:`TurnComplete`'s stop reason and usage are known.
    """
    fragments: dict[int, dict[str, Any]] = {}
    stop_reason = "end_turn"
    usage = TokenUsage()

    for chunk in chunks:
        if getattr(chunk, "usage", None):
            usage = TokenUsage(
                input_tokens=chunk.usage.prompt_tokens,
                output_tokens=chunk.usage.completion_tokens,
            )
        for choice in chunk.choices or []:
            delta = choice.delta
            if getattr(delta, "content", None):
                yield TextDelta(delta.content)
            for call in getattr(delta, "tool_calls", None) or []:
                fragment = fragments.setdefault(call.index, {"id": None, "name": None, "args": ""})
                if call.id:
                    fragment["id"] = call.id
                if call.function and call.function.name:
                    fragment["name"] = call.function.name
                if call.function and call.function.arguments:
                    fragment["args"] += call.function.arguments
            if choice.finish_reason:
                stop_reason = _STOP_REASONS.get(choice.finish_reason, "end_turn")

    for index in sorted(fragments):
        fragment = fragments[index]
        try:
            arguments = json.loads(fragment["args"]) if fragment["args"] else {}
        except json.JSONDecodeError:
            arguments = {}
        yield ToolUse(
            id=fragment["id"] or f"call_{index}",
            name=fragment["name"] or "",
            arguments=arguments,
        )
    yield TurnComplete(stop_reason, usage)


class OpenAiCompatibleProvider:
    """Streams a chat turn from an OpenAI-compatible endpoint (OpenAI / Ollama / gateway)."""

    def __init__(
        self,
        model: str,
        base_url: str,
        api_key: str | None = None,
        max_tokens: int | None = None,
    ) -> None:
        self._model = model
        self._max_tokens = max_tokens
        # The name the output cap is sent under: the platform's current one for OpenAI, the
        # widely supported legacy one elsewhere. A server that turns out to reject the legacy
        # name gets the newer one from then on (see :meth:`_open_stream`).
        self._token_param = _TOKEN_PARAM if is_openai_platform(base_url) else _LEGACY_TOKEN_PARAM
        self._client = OpenAI(base_url=base_url, api_key=api_key or _NO_KEY_PLACEHOLDER)

    def stream_turn(self, request: TurnRequest) -> Iterator[ProviderEvent]:
        """Stream one turn via the chat-completions API, yielding neutral events.

        Raises:
            ProviderRequestError: if the endpoint rejects or fails the request, carrying the
                provider's own explanation.
        """
        try:
            yield from parse_openai_stream(self._open_stream(request))
        except (APIConnectionError, AuthenticationError):
            # Not the provider's verdict on this request: leave these to the generic message.
            raise
        except APIError as exc:
            raise ProviderRequestError(
                f"The AI provider returned an error: {provider_error_reason(exc)}"
            ) from exc

    def _open_stream(self, request: TurnRequest) -> Any:
        """Start the streamed completion, adapting the output cap's name if it is refused."""
        try:
            return self._create(request)
        except BadRequestError as exc:
            # A gateway in front of a reasoning model can refuse ``max_tokens`` just as the
            # platform does; the request is rejected before any output, so retrying is safe.
            if self._token_param != _LEGACY_TOKEN_PARAM or not _rejects_legacy_token_param(exc):
                raise
            self._token_param = _TOKEN_PARAM
            return self._create(request)

    def _create(self, request: TurnRequest) -> Any:
        # Cap the answer's length when a budget was set, so the prompt plus the reply fit the
        # model's context window; a local runner with a small window relies on this.
        extra: dict[str, Any] = {}
        if self._max_tokens is not None:
            extra[self._token_param] = self._max_tokens
        # The SDK's typed overloads expect its own TypedDict params; we build plain dicts
        # (valid at the wire level) and translate the neutral turn ourselves.
        return self._client.chat.completions.create(  # type: ignore[call-overload]
            model=self._model,
            messages=to_openai_messages(request),
            tools=to_openai_tools(request.tools),
            stream=True,
            stream_options={"include_usage": True},
            **extra,
        )

    def list_models(self) -> list[str]:
        """List the model ids the endpoint offers.

        A cheap, read-only call that costs no tokens, used both to check the configuration
        and to populate the settings form's model picker — a real boon for a local runner
        such as Ollama, whose model tags are easy to mistype. Returns the ids in the order the
        endpoint reports them. Raises :class:`ProviderCheckError` with an actionable message
        on failure.
        """
        try:
            return [model.id for model in self._client.models.list()]
        except AuthenticationError as exc:
            raise ProviderCheckError("The provider rejected the API key.") from exc
        except APIConnectionError as exc:
            raise ProviderCheckError(
                "Could not reach the provider. Check the base URL and that the model server "
                "is running."
            ) from exc
        except APIError as exc:
            raise ProviderCheckError(f"The provider returned an error: {exc}") from exc

    def check(self) -> None:
        """Verify the endpoint is reachable and the key (if any) is accepted.

        Delegates to :meth:`list_models` — listing the models is the cheap, token-free call
        that both proves reachability and rejects a bad key — so the two share one error
        translation. Raises :class:`ProviderCheckError` on failure.
        """
        self.list_models()
