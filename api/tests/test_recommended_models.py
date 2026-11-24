"""The recommended models file: one source the backend and the web form both read."""

import json
from pathlib import Path

from shirube.adapters.ai import recommended
from shirube.adapters.ai.anthropic_provider import DEFAULT_MODEL

_FILE = Path(recommended.__file__).with_name("recommended_models.json")


def test_every_provider_has_a_recommended_model() -> None:
    models = json.loads(_FILE.read_text(encoding="utf-8"))

    # The web form reads exactly these keys, so a rename here would blank its suggestions.
    assert set(models) == {"anthropic", "openai", "ollama"}
    assert all(isinstance(name, str) and name.strip() == name and name for name in models.values())


def test_claude_falls_back_to_the_recommended_model() -> None:
    assert DEFAULT_MODEL == recommended.ANTHROPIC_MODEL
    assert recommended.OPENAI_MODEL and recommended.OLLAMA_MODEL
