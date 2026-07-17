# Design Decisions

This document records the key design decisions taken while shaping shirube, together
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
  `localhost`. A containerised shirube would need `host.docker.internal` and extra
  networking, creating a "first connection always fails" papercut. A single local
  command connects to a local *or* remote database with no networking friction — it is
  the superset that always works.
- The server binds to `127.0.0.1` only, so the MVP needs no authentication layer.
- A bundled sample database (via Docker) lets newcomers try shirube instantly.
- **Self-hosted / team server** is deferred to Phase 3; centralising everyone's
  credentials on a server would *reduce* trust, and it drags in multi-user auth that
  would bloat the MVP.

## 2. Vite React SPA, not Next.js; FastAPI serves the SPA

**Status:** Accepted

- The frontend is a Vite-built React SPA. In distribution, FastAPI serves the
  pre-built static files, so shirube is a single process on a single origin.
- **Why not Next.js:** shirube needs none of Next's strengths (SSR/SSG, SEO, server
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
- **SSH tunnel / bastion is out of shirube's responsibility.** Users establish their
  own tunnel (`ssh -L …`) and point shirube at `localhost`. Building tunnelling in
  brings key/passphrase/multi-hop complexity that pulls effort away from the core
  value; the OS already does this well.
- **Cloud IAM auth** (e.g. RDS IAM) is deferred to a later phase.

## 6. Relationship discovery: foreign keys plus manual editing

**Status:** Accepted; rule-based inference dropped

- The ER diagram draws edges from **declared foreign keys**.
- Because the target databases (legacy, poorly documented) often lack FK constraints,
  users can **manually add relationships**. These are stored in shirube's local config
  — the database is never modified — and are rendered distinctly from FK-derived edges
  so a manual/guessed link is never mistaken for a declared one.
- **Rule-based naming inference is dropped from the roadmap.** For the target
  databases its accuracy is unpredictable, and a *wrong* edge is worse than a missing
  one for a "don't get lost" tool — it actively misleads.
- **Future:** if inference is ever added, the right form is "the AI proposes candidate
  relationships, the user confirms", reusing the manual-add mechanism. The AI can also
  verify against real data, which beats a naming heuristic.

## 7. ER home screen: search + neighbourhood travel

**Status:** Accepted (revised — travel replaces accumulating expansion)

- Rendering hundreds of tables at once breaks both performance and readability, so
  shirube **never draws the whole schema by default**.
- The map always shows **one centre plus its direct (one-hop) neighbours** — a map
  zoomed to a place. Navigation is **travel, not accumulation**: clicking a neighbour
  recentres the map on it (like moving a map to a new place), and search moves the
  centre. The view is therefore identical whatever the schema's size.
- Because only one hop is drawn, a neighbour's own further connections are off the map.
  Nodes with such hidden connections show a short **stub line (with a count)** so "not
  connected" is distinguishable from "connected but not shown".
- On first connection (before any search) shirube centres on the **most-connected
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
  partition-heavy schema does not flood the map. Revealing them uses the scoped
  expand/collapse of §10.
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

## 10. Expand/collapse for partitions

**Status:** Accepted (revised)

Neighbourhood navigation moves by **travel** — clicking a table recentres on it (§7) —
not by accumulating expanded nodes. A scoped **expand/collapse** is kept for one thing:
showing or hiding a partitioned table's child partitions behind its parent, so a
partition-heavy schema does not flood the map.

*(Supersedes the earlier framing of a single expand/collapse primitive shared between
neighbourhood navigation and partitions; travel navigation replaced neighbourhood
expansion.)*

## 11. Table detail panel

**Status:** Accepted (data preview revised — see below)

- **Layout:** a left side panel, keeping the map in the centre and the AI chat on the
  right — a three-pane layout (detail | map | chat). The map is never hidden, so the
  user does not lose their place.
- **Contents:** columns (name, type, nullability, default, PK/FK, comment, enum
  values); relationships (both directions, each navigable — clicking moves the map);
  constraints, indexes, triggers; the table comment; an estimated row count.
- **Data preview:** a table or view's rows open **on demand in a drawer beneath the
  map** (a "View data" action on the detail panel), rather than loading automatically in
  the side panel — this keeps the ER map the focus. The drawer reads rows read-only
  (forced `LIMIT`, guarded by `statement_timeout`) with click-to-sort columns, simple
  AND-combined column filters, and paging. Showing a user their own data is not a privacy
  concern — they already have access; sending data to an external AI is a separate matter
  (see decision 13). *(Revised: originally a small sample auto-loaded inside the detail
  panel; it became an on-demand bottom drawer with sorting/filtering/paging.)*
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
- shirube ships **no default external provider**. The user explicitly configures a
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
  Orders → Payments) — the "route planner" that embodies *navigating a database like a
  map*.

## 16. Search stays deterministic; concepts are the AI's job

**Status:** Accepted

- Search is fast, case-insensitive substring matching over **table names, column names,
  and comments** (light fuzzy matching acceptable). Results navigate the map.
- **Semantic search is not in the MVP** — conceptual look-ups ("where is 売上?") are
  the AI's job, so an embedding index would duplicate that. It can later enrich the
  AI's look-up tools.

## 17. Build order: foundation first, then the AI navigator

**Status:** Accepted (revised — the foundation ships as a public beta)

shirube is built in two milestones:

- **Milestone 1 — Foundation:** connection → schema inspection → neighbourhood ER →
  table detail → data preview → search → relationship navigation. The whole
  architectural backbone, no AI. **Released as a public beta (`0.1.0b1`)** so the
  explorer core is validated against real databases before the AI is layered on.
- **Milestone 2 — AI navigator:** add the AI navigator on top of Milestone 1's schema
  look-up tools. This is the feature shirube is ultimately built around, and the next
  milestone after the beta.

*(Revised: Milestone 1 was originally kept internal, with the first public release
waiting for the AI in Milestone 2. Releasing the foundation as a beta gets real-world
feedback sooner and de-risks the AI work before it is layered on.)*

## 18. Branching: GitHub Flow

**Status:** Accepted

- `main` is the single long-lived branch, always in a releasable state.
- Work happens on short-lived feature branches merged via pull request — even solo, to
  build the habit and run CI per PR. Milestones are tracked with labels/issues, not
  long-lived branches.

---

## 19. Local persistence: SQLite, scoped to connection profiles

**Status:** Accepted

- shirube stores its own state in a single **SQLite** file in the OS config directory
  (resolved via `platformdirs`). Secrets — database passwords and AI API keys — live in
  the **OS keychain**, never in the SQLite file.
- Stored: connection profiles (non-secret fields), AI provider settings, ER node
  layout, manual relationships, and later saved views and chat history.
- **Per-database data (layout, manual relationships, view state) is keyed to the
  connection profile**, not to a host+port+database identity. Why: with external SSH
  tunnels every database appears as `localhost:5432`, so an identity-based key would
  conflate different databases; a user-named profile disambiguates reliably.
- The ER layout **auto-saves** per profile (with a reset-to-auto-layout action); there
  is no explicit save step.
- **Why SQLite over JSON/TOML:** structured, transactional, and robust as the data
  grows (profiles, layouts, relationships, saved views, chat history). It fits a
  database tool and reuses SQLAlchemy.

## 20. Schema introspection: fresh per connect, in-memory cache, drift-tolerant

**Status:** Accepted

- The schema is **re-introspected on each connect** and held in memory for the session;
  there is **no persistent schema cache**. Introspection of hundreds of tables is fast,
  and this avoids cache-invalidation complexity and stale, misleading metadata. A manual
  "refresh schema" action covers mid-session changes.
- Metadata is stored as **lightweight structures** queried from
  `information_schema`/`pg_catalog` on the backend — not full SQLAlchemy ORM reflection
  — keeping memory and startup light. The browser holds only the currently displayed
  neighbourhood.
- **Schema drift on reconnect:** layout entries for tables that no longer exist are
  silently skipped; manual relationships whose columns/tables no longer match are
  **kept but flagged "needs attention"** and never drawn as broken edges — the user
  re-maps or removes them. Renames are treated as drop+add (not auto-followed).

## 21. Onboarding and the sample database

**Status:** Accepted

- **First launch** (no profiles) opens the connection form directly; **subsequent
  launches** open the saved-profiles list. shirube **never auto-connects on launch** —
  the user always chooses a database (an optional "auto-connect to last profile"
  preference may come later). Avoiding surprise connections keeps it "never dangerous".
- The **sample database** is delivered via Docker Compose running **Postgres only**
  (e.g. `pagila`) — shirube itself is **not containerised** and always runs via `uvx`.
  The first-run screen offers a "sample database" connection preset pointing at the
  local sample Postgres, for a near-one-click demo.
- **Why not a SQLite sample:** the MVP speaks only Postgres, so a SQLite sample would
  force an off-mission SQLite adapter and would not exercise the real code path.

## 22. Error UX: translated, localised, non-destructive

**Status:** Accepted

- **Connect-time errors** are translated into plain-language messages with actionable
  hints (host/tunnel, credentials, database name, sslmode, permissions), shown inline
  on the form, with the raw driver error available under a "details" expander. A "test
  connection" action is available before saving.
- **Mid-session errors** are scoped to the affected area with a retry — a failed sample
  fetch never tears down the map or the app. **Structure (columns, relationships, from
  the catalog) is shown even when the data fetch fails** (permission/timeout), so a
  table can still be understood without reading its rows. Connection loss shows a
  reconnect banner; the saved layout persists.

## 23. Multiple databases and schemas

**Status:** Accepted

- **One connection profile maps to one database** (matching PostgreSQL's
  one-connection-one-database model and decision 19's keying). Browsing another database
  on the same server means another profile ("duplicate profile" eases this). An in-app
  server-level database switcher is deferred.
- **Schemas** selected at connect time are shown **together on one map**:
  schema-qualified node names (`schema.table`), visual grouping/colour per schema,
  cross-schema foreign keys drawn, and a per-schema visibility filter. System schemas
  are excluded by default.

## 24. AI chat: per-profile history and token display

**Status:** Accepted

- A conversation is **scoped to the connection profile** and its history is **persisted
  in SQLite**, so prior Q&A about a database can be revisited; "new conversation" and
  "clear" are available.
- **Token usage** (input/output, per response and cumulative) is shown from the
  provider's usage data; there is **no built-in currency conversion** (pricing tables go
  stale and mislead). Ollama shows "local, no API cost". A user-configurable rate for a
  rough cost estimate may come later.

## 25. UI language: English base with i18n scaffolding

**Status:** Accepted

- The UI ships in **English** (the widest OSS reach), but strings go through an **i18n
  layer** (keys + dictionaries) from the start rather than being hard-coded, so other
  languages (e.g. Japanese) can be added later by supplying a dictionary.

## 26. Licence: AGPL-3.0

**Status:** Accepted

- The project is licensed under **AGPL-3.0** — genuinely OSI-approved open source, whose
  network-copyleft clause deters a competitor from offering a closed, hosted shirube
  while the "commercial later" plan matures. As sole copyright holder we retain the
  option to **dual-licence** (a commercial licence for organisations that cannot accept
  AGPL).
- Because shirube is a **standalone, locally-run tool** rather than a library embedded
  in other software, AGPL's adoption friction is limited: internal local use does not
  trigger source disclosure.
- **Follow-up:** to preserve the ability to relicence/dual-licence once external
  contributors arrive, adopt a CLA or DCO before accepting outside contributions.
  Per-file AGPL notices are to be added as source is written.

## 27. Diagnostic logging: local, metadata-only

**Status:** Accepted

- shirube runs on the user's own machine, so a failure leaves no server-side trace to
  inspect. A `shirube` logger writes to the console and a **rotating file beside the
  app-state database** (`data_dir/shirube.log`), at `INFO` by default and raisable to
  `DEBUG` via `SHIRUBE_LOG_LEVEL`.
- **Logged:** a startup line; each request's method, path, status and duration; the
  underlying cause behind a translated error (e.g. the raw driver error behind "could
  not connect", which the user-facing message hides); and the traceback of any
  unexpected exception.
- **Never logged:** the *contents* a query touched — no filter values, no row data, no
  passwords. Only metadata. The read-only, local-first privacy posture (decisions 4 and
  14) must hold in the log too, since a released tool runs against real, possibly
  sensitive databases.
