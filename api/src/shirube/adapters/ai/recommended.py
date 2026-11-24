"""The models shirube recommends for each provider.

They live in ``recommended_models.json`` beside this module — the one place to change when a
newer model should become the suggestion. The web settings form imports the same file, and
the live navigator test runs against these models by default, so one edit moves the backend
default, the form's suggestions and the live check together.
"""

import json
from importlib.resources import files

_RECOMMENDED: dict[str, str] = json.loads(
    files(__package__).joinpath("recommended_models.json").read_text(encoding="utf-8")
)

# Used when a Claude setup leaves the model blank, and prefilled by the settings form.
ANTHROPIC_MODEL = _RECOMMENDED["anthropic"]
# Suggested (never prefilled) by the settings form for the OpenAI platform.
OPENAI_MODEL = _RECOMMENDED["openai"]
# Suggested (never prefilled) by the settings form for a local Ollama.
OLLAMA_MODEL = _RECOMMENDED["ollama"]
