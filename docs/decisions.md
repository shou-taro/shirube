# Design decisions

Why shirube is built the way it is. The point of this record is the *why* — so a
contributor (or a later you) can understand a trade-off instead of re-opening it.

It has two parts:

- **Decided** — settled choices that shape the shipped product.
- **Tentative** — current thinking on parts **not yet built** (chiefly the AI
  navigator). Design intent, not commitments; expect it to change once the code exists.

Status shorthand: **Built** (in the shipped beta), **Committed** (settled, not yet
built), **Active** (an ongoing practice).

---

## Decided

### Local-first, single-command distribution

**Built.**

- The primary entry point is one command (`uvx shirube`) that starts a local server and
  opens the browser, connecting to a local *or* remote database with no networking
  friction. A Docker-only tool stumbles on `host.docker.internal` for the common
  localhost target; Docker Compose stays a secondary option for a bundled sample DB.
- The server binds to `127.0.0.1` only. Loopback binding is necessary but **not
  sufficient** on its own — see *Local web-surface hardening*.
- Self-hosted / team server is deferred; centralising credentials would reduce trust and
  drag in multi-user auth.

### Vite React SPA; FastAPI serves it

**Built.**

- A Vite-built React SPA; in distribution FastAPI serves the pre-built static files, so
  shirube is one process on one origin.
- **Not Next.js:** shirube needs none of its strengths (SSR/SEO/server components), and
  it would add a second backend and a Node runtime to a Python-distributed tool. If a
  hosted product is built later, its surface can use Next; the interactive UI (React
  Flow, shadcn/ui) ports across.

### Connection input and credential storage

**Built.**

- Named, switchable connection profiles (host / port / database / user / sslmode).
  Non-secret fields live in the app-state database; **passwords go in the OS keychain**
  via `keyring`, never in plaintext. Headless Linux without a Secret Service falls back
  to env / connection URL.
- **Why keychain:** the user hits the same database daily, so re-entry every session
  hurts, and `keyring` keeps the cost small.

### Read-only safety model

**Built.** "Never dangerous", enforced in layers:

- Recommend connecting with a read-only database role.
- No code path emits DML/DDL.
- Every connection runs as a read-only transaction with a `statement_timeout`.
- Result sets carry a forced `LIMIT`; queries are parameterised and single-statement.

### Local web-surface hardening

**Built.**

- shirube serves a local HTTP API, so its real exposure is **browser-driven**, not a
  missing login — a login screen would be theatre for a single-user localhost tool.
- **Host-header validation** (only loopback names + the bind host) is the core defence
  against **DNS rebinding**, where a page on another origin points its own hostname at
  `127.0.0.1` to reach the API through the browser. This is why loopback binding alone is
  not enough.
- Plus same-origin **security headers** (CSP, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`) and a loud **warning** if bound to a non-loopback address.
- A loopback auth token (to fend off *other local processes*) is deferred as a heavier,
  SPA-touching follow-up.

### Remote connections: SSL yes, tunnels no

**Built (SSL); scoped out (SSH); deferred (IAM).**

- SSL/TLS (sslmode, CA path) is supported — cloud databases need it.
- SSH tunnels are the user's job (`ssh -L …`, then point shirube at localhost); building
  tunnelling in brings key/passphrase/multi-hop complexity the OS already handles well.
- Cloud IAM auth (e.g. RDS IAM) is deferred.

### ER home: search + neighbourhood travel

**Built.**

- Never draw hundreds of tables at once. The map shows **one centre plus its one-hop
  neighbours**; navigation is **travel** — click a neighbour to recentre, and search
  moves the centre — so the view is the same whatever the schema's size.
- Off-map connections are marked with a **stub line and a count**, so "not connected"
  differs from "connected but not shown".
- The first connection centres on the **most-connected table** (the backbone) — the
  answer to "where do I start?". A "show everything / fit" affordance covers small
  schemas.

### Objects and edges on the map

**Built (tables/views/matviews; foreign-key and view-dependency edges).**

- **Nodes:** tables, views, materialised views. Indexes, constraints, triggers, types,
  sequences and comments belong **in the detail panel, not as nodes**. Out of scope (not
  a DBA tool): roles, extensions, tablespaces.
- **Edges** are visually distinct by meaning: **foreign-key** (declared) and
  **view-dependency** (a view → the relations it reads). A third kind — **manual**
  user-added links — is committed but not yet built (see Tentative).
- Relationships are drawn from **declared foreign keys**. **Rule-based name inference is
  rejected:** on legacy schemas its accuracy is unpredictable, and a *wrong* edge
  misleads worse than a missing one. If inference ever returns, it should be "the AI
  proposes, the user confirms", verified against real data.
- Deferred: hiding child partitions behind their parent; foreign tables;
  functions/procedures (they don't fit the "node with columns" model).

### Table detail and data preview

**Built.**

- A floating detail card over the map (map in the centre, AI pane on the right) — the map
  is never hidden. It shows columns (type, primary key, nullability) and relationships in
  both directions, each click-navigable. (Constraints, indexes, triggers and a row-count
  estimate are intended additions.)
- **Data preview** opens on demand in a **drawer beneath the map** (a "View data"
  action), not auto-loaded — the map stays the focus. Rows are read-only (forced `LIMIT`,
  `statement_timeout`) with click-to-sort columns, AND-combined column filters, and
  paging. Showing a user their own data is not a privacy concern; sending values to an AI
  is (see *AI: external-send privacy*, Tentative).
- For views, the definition SQL is de-emphasised — dependencies and output columns first.

### Local persistence: SQLite, keyed to profiles

**Built.**

- shirube's own state is a single **SQLite** file in the OS data directory
  (`platformdirs`); secrets stay in the keychain. Chosen over JSON/TOML for being
  structured and transactional as the data grows, and it reuses SQLAlchemy.
- Per-database state (layout, and later manual links / saved views) is keyed to the
  **profile**, not host+port+database — SSH tunnels make every database look like
  `localhost:5432`, so a user-named profile disambiguates. The ER layout auto-saves per
  profile.

### Schema introspection: fresh per connect, drift-tolerant

**Built.**

- Re-introspected on each connect and held in memory for the session — **no persistent
  schema cache** (introspection is fast; this avoids stale, misleading metadata). A
  manual "refresh" covers mid-session changes. Read from `pg_catalog` as lightweight
  structures, not full ORM reflection.
- On drift: layout for vanished tables is skipped; manual links that no longer match are
  kept but flagged "needs attention", never drawn as broken edges.

### Reconnect on reload; no surprise connections otherwise

**Built (revised).**

- First launch (no profiles) opens the connection form; otherwise the saved-profiles
  list. shirube reconnects to the **last-used profile on reload**, so a refresh doesn't
  drop you back to the connection screen — but it never connects to a *new* database
  without you choosing it. A sample database (pagila) is available for development via
  `scripts/dev-db.sh`.
- *(Revised: originally "never auto-connects on launch"; restoring the last profile on
  reload proved worth it, and it is scoped to the profile you last chose.)*

### Multiple schemas on one map

**Built.**

- One profile = one database (matches PostgreSQL; browsing another means another
  profile). Schemas chosen at connect time share one map, with schema-qualified names and
  cross-schema foreign keys drawn; system schemas are excluded by default.

### Error UX: translated, non-destructive

**Built (connect-time); partial (mid-session).**

- Connect errors become plain-language, actionable messages (host, credentials, database,
  sslmode, permissions), with a "test connection" before saving; the raw driver error is
  kept in the log.
- Mid-session errors are scoped with a retry — a failed data fetch never tears down the
  map, and structure is shown even when the data fetch fails.

### Search stays deterministic

**Built.**

- Fast, case-insensitive substring matching over table and column names; results navigate
  the map. Conceptual look-ups ("where is 売上?") are the AI's job, not an embedding index
  here.

### Diagnostic logging: local, metadata-only

**Built.**

- A `shirube` logger writes to the console and a rotating file beside the app-state
  database (`data_dir/shirube.log`; `INFO`, raisable via `SHIRUBE_LOG_LEVEL`).
- Logged: startup; each request's method / path / status / duration; the real cause
  behind a translated error; and unexpected tracebacks. **Never** filter values, row data
  or passwords — metadata only, so the read-only / local-first posture holds in the log
  too.

### UI language: English base with i18n

**Built.**

- Ships in English (widest reach), but every string goes through an i18n layer, so
  another language (e.g. Japanese) is a dictionary away.

### Licence: AGPL-3.0

**Committed.**

- AGPL-3.0 — genuine OSI open source whose network-copyleft deters a closed, hosted
  competitor while a "commercial later" plan matures; as sole copyright holder we keep the
  **dual-licence** option. As a standalone local tool, AGPL friction is limited (local use
  triggers no source disclosure).
- **Follow-up:** adopt a CLA/DCO before accepting outside contributions to preserve
  relicensing, and add per-file notices as source is written.

### Branching: GitHub Flow

**Active.**

- `main` is the single, always-releasable branch; work lands via short-lived PR branches
  (even solo, to run CI per PR).

---

## Tentative

Design intent for parts **not yet built** — chiefly the AI navigator (Milestone 2).
Recorded so the thinking isn't lost, but expect it to change once implemented.

### Build order: foundation first, then the AI navigator

- **Milestone 1 — Foundation** (connection, schema, ER, detail, data preview, search,
  navigation) is **built and released as a public beta (`0.1.0b1`)**.
- **Milestone 2 — the AI navigator**, the feature shirube is ultimately built around, is
  next, layered on Milestone 1's schema look-up tools. Releasing the foundation first
  gets real-world feedback and de-risks the AI work.

### AI: metadata only, never auto-executes

- The AI will reason over **schema metadata only** (names, types, PK/FK, comments,
  counts) and **propose**; a human clicks to run. It never executes SQL itself —
  resolving "answer where sales lives" against "never feel dangerous", and keeping data
  values away from the AI.

### AI: schema via look-up tools

- The AI won't be handed the whole schema (hundreds of tables blow the context window and
  cost). It gets **tools** to look things up on demand and pulls in only what a question
  needs — scaling to thousands of tables and minimising what is sent externally. Semantic
  (embedding-based) retrieval is a later enhancement.

### AI: external-send privacy

- **Data values never leave the machine.** No default provider ships; the user configures
  one (an OpenAI-compatible API *or* local Ollama), and that choice is the consent. Only
  question-relevant schema metadata is sent, and only to the chosen provider; Ollama stays
  fully local. A "preview what will be sent" is a later transparency feature.

### AI answers wired to the map

- Table names in an answer will be clickable and move/highlight the map, so the AI and the
  map feel like one navigator. Later, the AI draws a **path** across the diagram (e.g.
  Customer → Orders → Payments) — a route planner.

### AI chat: per-profile history and token display

- Conversations scoped to the profile and persisted in SQLite (revisit prior Q&A;
  new/clear available). Token usage shown from the provider; no built-in currency
  conversion (pricing drifts and misleads); Ollama shows "local, no API cost".

### Manual relationship editing

- For legacy schemas lacking FK constraints, let users **add relationships by hand**,
  stored locally (the database is never modified) and rendered distinctly from declared
  foreign keys, so a guess is never mistaken for a fact.

### Partition handling

- Hide a partitioned table's child partitions behind its parent (a scoped
  expand/collapse), so a partition-heavy schema doesn't flood the map.
