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
cd web && pnpm lint && pnpm test && pnpm build
```

Some backend tests are marked `integration` and need a real PostgreSQL — they prove the
SQL and the safety guarantees against a live server, which fakes cannot. They **skip**
unless `SHIRUBE_TEST_DATABASE_URL` points at a throwaway database (the tests create and
drop their own schemas). The local sample database works:

```bash
./scripts/dev-db.sh up
SHIRUBE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/pagila \
  uv run --directory api pytest -m integration
```

### End-to-end (Playwright)

A couple of journeys run through the whole stack — the built SPA served by the backend,
against a seeded throwaway schema. They need a reachable PostgreSQL and Chromium:

```bash
./scripts/build.sh                     # bundle the SPA into the API package first
cd web && pnpm exec playwright install chromium
SHIRUBE_E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/pagila \
  pnpm run test:e2e
```

Playwright starts the backend itself (on port 7473, with a throwaway data directory) and
seeds a `shirube_e2e` schema in the target database before the run.

### In VS Code

Both test suites run from the editor's **Testing** panel. The workspace recommends the
extensions that power it (see `.vscode/extensions.json`): the Python extension runs
pytest (already configured in `.vscode/settings.json` against `api/`), and the Vitest
extension discovers the frontend tests from `web/vite.config.ts`. Accept the
"install recommended extensions" prompt and both appear in the Testing panel to run or
debug individually.

## Testing

How the test suite is layered — and, in particular, which guarantees are covered by
dedicated security tests — is documented in [`docs/testing.md`](docs/testing.md).
