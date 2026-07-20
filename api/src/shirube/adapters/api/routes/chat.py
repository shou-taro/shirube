"""The AI navigator's chat endpoint (Milestone 2 — AI navigator).

Answers a question about a connected database and streams the reply as Server-Sent Events:
the assistant's text as it arrives, a marker for each look-up the model makes, then a final
done (or error) frame. Streaming is what lets the answer appear token by token rather than
after a long pause — and, since a turn may involve several tool-calling round trips, keeps
the connection alive throughout.

The provider is chosen and reached entirely on the user's machine (see the factory and
:mod:`shirube.application.navigator`): only question-relevant schema metadata leaves, and a
local model sends nothing outward at all.
"""

import json
from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from shirube.adapters.api.dependencies import get_navigator_service
from shirube.application.navigator import NavigatorService
from shirube.domain.chat import (
    ChatMessage,
    ChatRole,
    NavigatorDone,
    NavigatorEvent,
    NavigatorTextDelta,
    NavigatorToolCall,
)

router = APIRouter(prefix="/profiles", tags=["chat"])


class ChatMessageIn(BaseModel):
    """One message of conversation history sent up with a question.

    Only user and assistant messages make up the visible history; the tool calls exchanged
    within a turn are the navigator's own business and never appear here (a ``tool`` role is
    rejected).
    """

    role: ChatRole
    content: str

    @field_validator("role")
    @classmethod
    def _reject_tool_role(cls, role: ChatRole) -> ChatRole:
        """Refuse a ``tool`` role — history is only ever user and assistant messages."""
        if role is ChatRole.TOOL:
            raise ValueError("Chat history may only contain user and assistant messages.")
        return role

    def to_domain(self) -> ChatMessage:
        """Convert to the neutral chat message the navigator consumes."""
        return ChatMessage(role=self.role, content=self.content)


class ChatRequest(BaseModel):
    """A chat request: the conversation so far, ending with the user's latest question."""

    messages: Annotated[list[ChatMessageIn], Field(min_length=1)]


def _to_sse(event: NavigatorEvent) -> str:
    """Serialise one navigator event as a Server-Sent Events frame.

    Each frame is a named event plus a JSON ``data`` line, so the client can switch on the
    event name: ``text`` (an answer chunk), ``tool_call`` (a look-up, for a "looking things
    up…" indicator), ``done`` (finished, with token usage), or ``error`` (a user-safe
    message). The trailing blank line terminates the frame per the SSE format.
    """
    name: str
    data: dict[str, Any]
    if isinstance(event, NavigatorTextDelta):
        name, data = "text", {"text": event.text}
    elif isinstance(event, NavigatorToolCall):
        name, data = "tool_call", {"name": event.name}
    elif isinstance(event, NavigatorDone):
        name, data = (
            "done",
            {
                "usage": {
                    "input_tokens": event.usage.input_tokens,
                    "output_tokens": event.usage.output_tokens,
                }
            },
        )
    else:  # NavigatorError
        name, data = "error", {"message": event.message}
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"


NavigatorDep = Annotated[NavigatorService, Depends(get_navigator_service)]


@router.post("/{profile_id}/chat")
def chat(profile_id: str, body: ChatRequest, navigator: NavigatorDep) -> StreamingResponse:
    """Answer the latest question about a profile's database, streaming the reply as SSE.

    A missing provider configuration is refused before streaming begins (a plain 400).
    Everything that can go wrong once the answer is under way — a missing profile, an
    unreachable model, the model looping without answering — arrives as an ``error`` frame
    within the stream, since the response is already committed by then.
    """
    history = [message.to_domain() for message in body.messages]

    def frames() -> Iterator[str]:
        for event in navigator.ask(profile_id, history):
            yield _to_sse(event)

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        # Keep proxies and the browser from buffering the stream, so frames arrive live.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
