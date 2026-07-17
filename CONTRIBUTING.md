# Contributing to shirube

Thanks for your interest in shirube. This document covers how to run the project from
source; see [`docs/decisions.md`](docs/decisions.md) for the reasoning behind each
design decision.

## Layout

- `api/` — the backend: FastAPI, package `shirube`. In distribution it also serves the
  built single-page app, so shirube runs as one process on one origin.
- `web/` — the frontend: Vite + React + TypeScript.

## Prerequisites

- [uv](https://docs.astral.sh/uv/)
- Node.js
- [pnpm](https://pnpm.io/) (e.g. `corepack enable pnpm`)

## Running in development

Two dev servers, with the frontend proxying `/api` to the backend:

```bash
# terminal 1 — backend on http://127.0.0.1:7472
cd api && uv sync && uv run uvicorn shirube.adapters.api.app:app --reload --port 7472

# terminal 2 — frontend dev server on http://localhost:5173
cd web && pnpm install && pnpm dev
```

## Running as it ships

The backend serving the built SPA on a single origin:

```bash
./scripts/build.sh                # build the SPA and bundle it into the API package
uv run --directory api shirube    # serves UI + API on http://127.0.0.1:7472
```

A local sample database (pagila) is available via `scripts/dev-db.sh` for development.

## Checks

These mirror CI; run them before opening a pull request:

```bash
cd api && uv run ruff check . && uv run ruff format --check . && uv run mypy -p shirube && uv run pytest
cd web && pnpm lint && pnpm build
```
