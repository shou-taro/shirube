# Shirube

**しるべ** — a guide, a signpost.

**AI-native database explorer.** Shirube helps developers navigate and understand
relational databases through visual exploration and AI guidance, rather than by
writing SQL by hand.

> Navigate and understand your database with AI.

## Status

Early development. The design is being finalised — see [`docs/vision.md`](docs/vision.md)
and [`docs/decisions.md`](docs/decisions.md) for the product vision and the reasoning
behind each design decision.

## What it is

- Starts from an interactive ER diagram, not a SQL editor.
- Explore tables, columns, sample data and relationships visually.
- Ask an AI navigator where data lives and how tables connect.
- Read-only and safe by design.

Shirube is **not** a SQL IDE or a database administration tool. It is a tool for
*understanding* a database — for developers joining an existing project with hundreds
of tables and little documentation.

## Tech stack

- **Frontend:** React, TypeScript, shadcn/ui, React Flow (Vite)
- **Backend:** FastAPI, SQLAlchemy
- **Database:** PostgreSQL (MySQL and SQL Server planned)
- **AI:** pluggable providers behind a common interface (OpenAI-compatible, Ollama)

## Development

Prerequisites: [uv](https://docs.astral.sh/uv/) and Node.js. The backend lives in
`api/` (FastAPI, package `shirube`) and the frontend in `web/` (Vite + React).

Run in development — two processes, with the frontend proxying `/api` to the backend:

```bash
# terminal 1 — backend on http://127.0.0.1:7472
cd api && uv sync && uv run uvicorn shirube.adapters.api.app:app --reload --port 7472

# terminal 2 — frontend dev server on http://localhost:5173
cd web && npm install && npm run dev
```

Run as a single origin — the backend serves the built SPA on one port:

```bash
./scripts/build.sh                # build the SPA and bundle it into the API package
uv run --directory api shirube    # serves UI + API on http://127.0.0.1:7472
```

Checks:

```bash
cd api && uv run ruff check . && uv run mypy -p shirube && uv run pytest
cd web && npm run lint && npm run build
```

## Licence

Shirube is licensed under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

As sole copyright holder, the project may additionally be offered under a commercial
licence in future (dual-licensing) for organisations that cannot use AGPL-3.0.
