# Design Decisions

This document records the key design decisions taken while shaping Shirube, together
with the reasoning behind each one. The *why* matters as much as the *what*: it lets
future contributors (and future us) understand the trade-offs rather than re-litigate
them.

Each decision notes its status. "Accepted" means settled for the MVP; "Deferred"
means intentionally postponed to a later phase.

---

## 1. Local-first, single-command distribution

**Status:** Accepted

- The primary entry point is a single command (`uvx shirube` / `pipx install shirube`)
  that starts a local server and opens the browser. Docker Compose is a secondary
  option for isolation and for bundling a sample database.
- **Why single command over Docker-only:** the target database is often on
  `localhost`. A containerised Shirube would need `host.docker.internal` and extra
  networking, creating a "first connection always fails" papercut. A single local
  command connects to a local *or* remote database with no networking friction — it is
  the superset that always works.
- The server binds to `127.0.0.1` only, so the MVP needs no authentication layer.
- A bundled sample database (via Docker) lets newcomers try Shirube instantly.
- **Self-hosted / team server** is deferred to Phase 3; centralising everyone's
  credentials on a server would *reduce* trust, and it drags in multi-user auth that
  would bloat the MVP.

## 2. Vite React SPA, not Next.js; FastAPI serves the SPA

**Status:** Accepted

- The frontend is a Vite-built React SPA. In distribution, FastAPI serves the
  pre-built static files, so Shirube is a single process on a single origin.
- **Why not Next.js:** Shirube needs none of Next's strengths (SSR/SSG, SEO, server
  components) — it is a localhost, single-user, interactive-canvas app, exactly what
  SPAs do best. Next would add a second backend alongside FastAPI and require a Node
  runtime in a Python-distributed tool. Static-export Next would just be a heavier SPA.
- **Migration path:** if a hosted cloud product is built later (Phase 3), that surface
  can use Next.js. The valuable interactive UI (ER diagram, table viewer, chat) is
  React and ports across; shadcn/ui and React Flow work in both. So choosing Vite now
  does not lock us out of Next later.

## 3. Connection input and credential storage

**Status:** Accepted

- Support both a connection URL and individual fields (host / port / database / user /
  password / sslmode). Multiple named profiles, switchable.
- **Secret vs non-secret split:** non-secret fields are saved to a local config file
  as named profiles; passwords are stored in the OS keychain via the `keyring` library
  (macOS Keychain / Windows Credential Manager / Linux Secret Service). Passwords are
  never stored in plaintext.
- On headless Linux where no Secret Service is available, fall back to passing
  credentials via environment variables / connection URL.
- **Why keychain:** the target user touches the same database daily; forcing re-entry
  every session hurts the experience, and `keyring` keeps the added cost small.

## 4. Read-only safety model

**Status:** Accepted

Even sample data and AI look-ups are `SELECT`s. "Never dangerous" is enforced in
layers:

1. Recommend (and prompt for) connecting with a read-only database role.
2. No code path in the MVP emits DML/DDL.
3. Every query runs in a read-only transaction (`SET TRANSACTION READ ONLY`).
4. A `statement_timeout` guards against runaway queries.
5. Sample data and result sets carry a forced `LIMIT`.
6. Multi-statement queries are rejected.

## 5. Remote / team connections

**Status:** Mixed (SSL accepted; SSH tunnel out of scope; IAM deferred)

- **SSL/TLS is in the MVP** (sslmode, CA certificate path) — cloud databases need it.
- **SSH tunnel / bastion is out of Shirube's responsibility.** Users establish their
  own tunnel (`ssh -L …`) and point Shirube at `localhost`. Building tunnelling in
  brings key/passphrase/multi-hop complexity that pulls effort away from the core
  value; the OS already does this well.
- **Cloud IAM auth** (e.g. RDS IAM) is deferred to a later phase.

## 6. Relationship discovery: foreign keys plus manual editing

**Status:** Accepted; rule-based inference dropped

- The ER diagram draws edges from **declared foreign keys**.
- Because the target databases (legacy, poorly documented) often lack FK constraints,
  users can **manually add relationships**. These are stored in Shirube's local config
  — the database is never modified — and are rendered distinctly from FK-derived edges
  so a manual/guessed link is never mistaken for a declared one.
- **Rule-based naming inference is dropped from the roadmap.** For the target
  databases its accuracy is unpredictable, and a *wrong* edge is worse than a missing
  one for a "don't get lost" tool — it actively misleads.
- **Future:** if inference is ever added, the right form is "the AI proposes candidate
  relationships, the user confirms", reusing the manual-add mechanism. The AI can also
  verify against real data, which beats a naming heuristic.

## 7. ER home screen: search + neighbourhood expansion

**Status:** Accepted

- Rendering hundreds of tables at once breaks both performance and readability, so
  Shirube **never draws the whole schema by default**.
- The interaction is always **search + neighbourhood expansion**: pick a table, render
  it and its 1–2 hop neighbours, and expand further on click — like panning a map.
- On first connection (before any search) Shirube centres on the **most-connected
  table** (the schema's "backbone"), which directly addresses "I don't know where to
  start."
- A **"show everything / fit to view"** affordance covers small databases where seeing
  the whole graph is pleasant.
- **Domain-cluster overview** (grouping by schema/naming) is deferred as a future
  higher zoom level.

## 8. Objects shown on the map

**Status:** Accepted

- **Nodes (MVP):** tables, views, materialised views.
- **Foreign tables:** excluded from the MVP; a Phase 2 candidate, not yet committed.
- **Partitions:** child partitions are hidden by default (parent shown only), so a
  partition-heavy schema does not flood the map. No bespoke partition feature — the
  hide/expand behaviour reuses the generic expand/collapse primitive (see below).
- **Inside the table detail panel, not as nodes:** indexes, constraints (incl. CHECK,
  which often encodes business rules), triggers, enum/custom types, sequences, and
  comments.
- **Out of scope (not a DBA tool):** roles/permissions, extensions, tablespaces.
- **Deferred (Phase 2):** functions / stored procedures — high value for
  understanding, but they do not fit the "node with columns" model and are harder to
  trace.

## 9. Three kinds of relationship edges

**Status:** Accepted

Edges carry different meanings and must be visually distinct:

1. **Foreign-key edges** — table → table references (declared, official).
2. **View-dependency edges** — view → source tables (data derivation/flow, official).
3. **Manual edges** — user-added, best-guess links.

## 10. Generic expand/collapse primitive

**Status:** Accepted

"Click a table to reveal its neighbours" and "click a partition parent to reveal its
children" are the *same* operation. Shirube builds **one** generic expand/collapse
primitive (with auto-layout) and reuses it for neighbourhood navigation and partition
expansion, rather than a special-purpose partition feature.

## 11. Table detail panel

**Status:** Accepted

- **Layout:** a left side panel, keeping the map in the centre and the AI chat on the
  right — a three-pane layout (detail | map | chat). The map is never hidden, so the
  user does not lose their place.
- **Contents:** columns (name, type, nullability, default, PK/FK, comment, enum
  values); relationships (both directions, each navigable — clicking moves the map);
  constraints, indexes, triggers; the table comment; an estimated row count.
- **Sample data:** a small number of rows is loaded automatically when the panel
  opens (forced `LIMIT`, no `ORDER BY` so it returns instantly even on large tables,
  guarded by `statement_timeout`). More rows / paging are loaded on demand. Showing a
  user their own data is not a privacy concern — they already have access; sending data
  to an external AI is a separate matter (see decision 13).
- **Views / materialised views:** the definition SQL is de-emphasised — dependencies
  and output columns are shown first, the raw SQL sits in a collapsed, scrollable,
  syntax-highlighted block, and the AI can summarise a long definition in plain
  language.

## 12. AI accesses metadata only, and never auto-executes

**Status:** Accepted

- In the MVP the AI reasons over **schema metadata only** (names, types, PK/FK,
  comments, row counts). It proposes; a human clicks to run. The AI never executes SQL
  automatically. This resolves the tension between "answer where sales is stored" and
  "never feel dangerous", and keeps data values away from the AI.

## 13. AI retrieves schema via tools (scales to large schemas)

**Status:** Accepted

- The full metadata of hundreds of tables can exceed an LLM's context window (and cost
  grows with tokens). So the AI is **not** handed the whole schema. Instead it is given
  **tools** to look things up on demand (search tables, fetch a table's columns, etc.)
  and pulls in only what a given question needs.
- **Why:** it scales to thousands of tables; it embodies "the AI navigates the schema
  like the user navigates the map"; and it minimises what is sent to an external
  provider.
- Semantic (embedding-based) retrieval is a future enhancement to the look-up tools.

## 14. External-send privacy policy

**Status:** Accepted (send-preview deferred)

- **Data values never leave the machine** (a consequence of decisions 12–13).
- Shirube ships **no default external provider**. The user explicitly configures a
  provider at setup — an OpenAI-compatible API *or* local Ollama — and that choice is
  the consent. Only the schema metadata relevant to a question is sent, and only to the
  chosen provider.
- Stated principle: *data values never leave; schema names go only to the provider you
  choose; use Ollama to stay fully local.*
- A "preview what will be sent" feature is deferred as a future transparency
  enhancement.

## 15. AI answers are wired to the map

**Status:** Accepted (path-drawing is an early enhancement)

- **MVP:** table names in an AI answer are clickable and move/highlight the map, so the
  AI and the map feel like one navigator.
- **Early enhancement:** the AI draws a *path* on the ER diagram (e.g. Customer →
  Orders → Payments) — the "route planner" that embodies *Google Maps for databases*.

## 16. Search stays deterministic; concepts are the AI's job

**Status:** Accepted

- Search is fast, case-insensitive substring matching over **table names, column names,
  and comments** (light fuzzy matching acceptable). Results navigate the map.
- **Semantic search is not in the MVP** — conceptual look-ups ("where is 売上?") are
  the AI's job, so an embedding index would duplicate that. It can later enrich the
  AI's look-up tools.

## 17. Build order: foundation first, release with AI

**Status:** Accepted

- **M1 (internal):** connection → schema inspection → neighbourhood ER → table detail →
  search → relationship navigation. The whole architectural backbone, no AI. Usable for
  dogfooding, but not released.
- **M2 (public release):** add the AI navigator on top of M1's schema look-up tools,
  then release. The public product is therefore AI-native from day one, while the
  foundation is proven before the AI is layered on.

## 18. Branching: GitHub Flow

**Status:** Accepted

- `main` is the single long-lived branch, always in a releasable state.
- Work happens on short-lived feature branches merged via pull request — even solo, to
  build the habit and run CI per PR. Milestones are tracked with labels/issues, not
  long-lived branches.
