# shirube

**標べ** (*shirube*) — a guide, a signpost.

Explore and understand an unfamiliar database as a **map**, not a pile of tables.
shirube opens on an interactive ER diagram and lets you follow relationships, read a
table's structure, and preview its rows — all read-only, all on your own machine.

> **Status: Beta.** The explorer core is here and usable today. The AI navigator — the
> feature shirube is ultimately built around — is the next milestone (see the
> [roadmap](#roadmap)). shirube is pre-1.0: things may still change.

<!-- TODO(release): add a hero screenshot of the ER diagram home to docs/images/ and embed it here. -->

## Why shirube

Most database tools start with a table list and a SQL editor. That is fine once you
know a schema — and painful when you don't. Joining a project with hundreds of tables,
no documentation, and no idea where anything lives, the first question is never "what
SQL do I write?" It's **"where is this, and how does it connect?"**

shirube is built around that question. The goal is not *"don't write SQL"* — it's
**"don't get lost."** It answers things like:

- Where does this data live, and which table owns this column?
- How are these two tables related? Where does this foreign key lead?
- Which table should I even start from?

Think of it as **Google Maps for a database**: you never see the whole world at once —
you search, focus on one place, and pan outward along the connections.

shirube is **not** a SQL IDE or a database administration console. It is a tool for
*understanding* a database.

## Features

Everything below works today, in the beta:

- **ER diagram home.** shirube generates the diagram automatically and centres it on the
  most-connected table. You see a table and its immediate neighbours — not a wall of
  hundreds — and travel outward one hop at a time.
- **Table detail.** Columns with their types, primary keys and nullability, plus
  relationships split into *references* and *referenced by* — including the tables a view
  reads from.
- **Relationship navigation.** Click a related table to glide the map over to it, and
  keep following the connections.
- **Data preview.** Read a table or view's actual rows in a drawer beneath the map, with
  click-to-sort columns, simple column filters, and paging.
- **Instant search.** Press <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> to jump straight to any
  table or column.
- **Saved connections.** Manage several PostgreSQL profiles; passwords are kept in your
  operating system's keychain, never in a config file.
- **Light and dark themes.**

## Safe by design

shirube is meant never to feel dangerous.

- **Read-only.** Every connection is opened read-only with a statement timeout. shirube
  cannot modify your database — no writes, no schema changes, ever.
- **Local-first.** It runs on your machine and binds to `127.0.0.1` only. Your database
  credentials and data never leave your computer; passwords live in the OS keychain.
- **Metadata-only logging.** The local log records what is needed to diagnose a problem
  (errors, request timings) but never the values in your data.

## Getting started

**Requirements:** a reachable PostgreSQL database, and [uv](https://docs.astral.sh/uv/)
(which provides `uvx`).

```bash
uvx shirube
```

That starts a local server and opens shirube in your browser. Add a connection to your
PostgreSQL database and you're exploring — the database can be local or remote.

> shirube connects with whatever credentials you give it; a read-only role with
> `CONNECT` and `SELECT` is all it needs, and all it should have.

## Roadmap

shirube's development runs in three phases.

- **Now — Explore (beta).** The ER diagram, table detail, relationship navigation, data
  preview and search described above.
- **Next — the AI navigator.** Ask, in plain language, where data lives and how tables
  connect, and let the guide lead you there. The AI is a *navigator*, not a SQL
  generator, and it never changes anything. This is the headline feature still to land.
- **Later — Analyse & Manage.** Richer GUI filters and aggregation, saved views,
  AI-suggested relationships and semantic search; then safe, GUI-driven editing and
  team / self-hosted features. MySQL and SQL Server will follow PostgreSQL behind a
  database adapter.

See [`docs/vision.md`](docs/vision.md) for the full product vision and
[`docs/decisions.md`](docs/decisions.md) for the reasoning behind each design decision.

## How it works

shirube ships as a single local process: a FastAPI backend that also serves the built
React single-page app, so the UI and API share one origin on `127.0.0.1`. The backend
reads your database through a read-only adapter (PostgreSQL today), and the AI will sit
behind a provider interface — OpenAI-compatible APIs and Ollama first — isolated from
the rest of the application.

## Development

The backend lives in `api/` (FastAPI, package `shirube`) and the frontend in `web/`
(Vite + React + TypeScript). Prerequisites: [uv](https://docs.astral.sh/uv/), Node.js,
and [pnpm](https://pnpm.io/) (e.g. `corepack enable pnpm`).

Run the two dev servers, with the frontend proxying `/api` to the backend:

```bash
# terminal 1 — backend on http://127.0.0.1:7472
cd api && uv sync && uv run uvicorn shirube.adapters.api.app:app --reload --port 7472

# terminal 2 — frontend dev server on http://localhost:5173
cd web && pnpm install && pnpm dev
```

Or run it the way it ships — the backend serving the built SPA on one origin:

```bash
./scripts/build.sh                # build the SPA and bundle it into the API package
uv run --directory api shirube    # serves UI + API on http://127.0.0.1:7472
```

Checks (these mirror CI):

```bash
cd api && uv run ruff check . && uv run ruff format --check . && uv run mypy -p shirube && uv run pytest
cd web && pnpm lint && pnpm build
```

## Licence

shirube is licensed under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

As sole copyright holder, the project may additionally be offered under a commercial
licence in future (dual-licensing) for organisations that cannot use AGPL-3.0.
