# Design decisions

Why shirube is built the way it is. The point of this record is the *why* — so that
future contributors and maintainers can understand a trade-off instead of re-opening it.

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
  via `keyring`, never in plaintext — the macOS Keychain or Windows Credential Manager.
  The beta targets **macOS and Windows**, where a secure keychain is always present;
  Linux support (a Secret Service such as GNOME Keyring, or an env / connection-URL
  fallback) is **planned, not yet supported**. A plaintext keyring backend is never
  recommended, as it would defeat the whole point.
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

- SSL/TLS via `sslmode` is supported — cloud databases need it. Choosing a custom CA
  path (`sslrootcert`) from the UI is **planned, not yet built**; today libpq's default
  CA file location is used, so `verify-ca` / `verify-full` require the CA in
  `~/.postgresql/root.crt` (or the platform-equivalent standard location).
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
  `localhost:5432`, so a user-named profile disambiguates. Persisting that per-profile
  state, starting with the ER layout, is **planned, not yet built**; today the map is
  laid out afresh each session.

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
  drop the user back to the connection screen — but it never connects to a *new* database
  without the user choosing it. A sample database (pagila) is available for development
  via `scripts/dev-db.sh`.
- *(Revised: originally "never auto-connects on launch"; restoring the last profile on
  reload proved worth it, and it is scoped to the profile the user last chose.)*

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

### Diagnostic logging: local, structured, metadata-only

**Built.**

- **Structured logging** (`structlog` over the standard library): each event is a set of
  key/value fields, rendered two ways from one source — a colourised, human-readable line
  on the **console** and one **JSON object per line** in a rotating file beside the
  app-state database (`data_dir/shirube.log`; `INFO`, raisable via `SHIRUBE_LOG_LEVEL`).
  The JSON file stays greppable and tool-friendly without sacrificing console readability.
- **Layered on stdlib, not replacing it.** structlog builds the event dict and defers
  emission to a `logging` handler, so rotation, levels, uvicorn's own loggers and the
  test suite's `caplog` all keep working. This is why the structured events still reach
  the standard library rather than a separate sink.
- A per-request **`request_id`** is bound for the request's lifetime and attached to every
  event it logs, and returned in the `X-Request-ID` response header — so a user-reported
  request can be traced through the log.
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
  competitor while a "commercial later" plan matures; the sole copyright holder retains
  the option to **dual-licence**. As a standalone local tool, AGPL friction is limited
  (local use triggers no source disclosure).
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

### AI: model tiers and provider abstraction

- Two ways to bring intelligence to the navigator:
  1. **Bring your own API key** — a hosted provider the user already pays for (Claude, or
     any OpenAI-compatible endpoint).
  2. **Local model** — a model running on the user's own machine (Ollama and other
     OpenAI-compatible local runners), for full privacy.
- Both keep shirube's core promise: no shirube backend, calls go straight from the user's
  machine to their chosen provider or local model, and only question-relevant metadata
  leaves (a local model leaves nothing).
- **Two provider adapters** behind one internal interface:
  - **Anthropic native** — talks to the Claude API directly, so Claude (the recommended
    default) gets first-class tool use and thinking rather than a lowest-common-denominator
    shim.
  - **OpenAI-compatible** — one adapter covers OpenAI, Ollama, and the many local runners
    and gateways that speak the OpenAI chat-completions shape. Ollama is reached this way;
    there is no separate Ollama adapter.
- **No provider ships enabled by default** (as with connections — see *external-send
  privacy* below); the user picks and configures one, and that choice is the consent. The
  recommended default *model*, once a provider is chosen, is the latest Claude; a
  schema-navigator may run well on a cheaper or smaller model, so this is a calibration to
  revisit, not a fixed cost.
- Adapters expose only what the navigator needs — a chat turn with tool-calling — so
  adding an engine later is a new adapter rather than a rewrite.

### AI: provider config and key handling

- The chosen provider is configured **once, app-wide** — one active provider at a time, not
  a separate one per database profile. Non-secret settings (which adapter, base URL, model
  name) live in the app-state database alongside the other settings.
- **API keys are secrets → the OS keychain**, via the same `keyring` path as database
  passwords (macOS Keychain / Windows Credential Manager), never in a config file or the
  app-state database. Same platform scope as connection credentials: macOS and Windows for
  the beta, a Linux fallback planned.
- **Local models need no key** — Ollama and other local runners take only a base URL (e.g.
  `http://localhost:11434`), so tier 2 stores nothing secret at all.
- The provider/key being app-wide (while conversations stay per-profile — see *per-profile
  history* below) means a key set once works across every database profile.

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

### AI: the look-up tool set

- A small, fixed set of read-only tools, all metadata-only, over the **already-introspected
  schema** (built at connect — see *schema introspection* above), so the AI sees exactly
  what the map sees and no re-query or live database hit is needed:
  - **`search_objects(query, limit)`** — the entry point ("which table do I start from"):
    ranked name/column matches, reusing the deterministic search already built. Returns
    each hit's id, name, kind (table / view / materialised view), schema, and cheap signals
    (column count, catalogue row-count estimate).
  - **`get_object(ref)`** — one object's detail: columns (name, type, nullable, primary
    key, comment) plus relationships split into *references* / *referenced by*, each tagged
    `foreign_key` or `view_dependency`. This is the map's table detail, for the AI.
  - **`find_path(from, to)`** — a breadth-first walk over the relationship graph returning
    the hop sequence between two objects (e.g. Customer → Orders → Payments). One cheap,
    deterministic call answers "how are these related" instead of many `get_object` hops.
  - **`list_schemas()`** — cheap orientation on a multi-schema database: schema names with
    object counts.
- **What tools return:** metadata only — names, types, keys, nullability, comments,
  relationship kinds, and count *estimates*. **What they never return: row data or column
  values.** Row-count *estimates* come from the catalogue, not a scan, and are the only
  numeric signal exposed. The AI proposes; a human clicks through to the data preview to
  see actual rows.
- Tools run **on the local backend**; only their results (question-relevant metadata) enter
  the conversation and thus the external-send surface. The AI pulls incrementally — one
  search, then the objects that matter — rather than receiving the schema up front.
- Cross-object **path finding** is in M2 as the `find_path` tool above (backend BFS over
  the relationship graph — fast and reliable regardless of schema size). Only the
  **visual** route — drawing/highlighting the A → B → C path across the ER diagram (see
  *answers wired to the map*) — is deferred; M2 answers path questions in text with
  clickable hops.
- The set assumes a **function-calling-capable model** (see *model tiers*). A no-tool
  degraded path — packing a bounded, question-relevant metadata slice straight into the
  prompt for weaker local models — is a later consideration, not part of the first cut.

### AI: external-send privacy

- **Data values never leave the machine.** No default provider ships; the user configures
  one (Claude, an OpenAI-compatible API, *or* local Ollama — see *model tiers and provider
  abstraction* above), and that choice is the consent. Only question-relevant schema
  metadata is sent, and only to the chosen provider; a local model stays fully local. A
  "preview what will be sent" is a later transparency feature.

### AI: the consent flow

- **Choosing a hosted provider is the consent — but it must be an informed one.** The first
  time a hosted provider (tier 1) is configured, shirube states plainly, in one place, what
  it will and won't send: it sends the **question, the running conversation, and
  question-relevant schema metadata** (table/column names, types, keys, comments,
  relationship structure, row-count estimates) to that provider; it **never** sends row
  data or column values. The user acknowledges once, and that is the record of consent.
- **Local models skip it** — Ollama and other local runners send nothing off the machine,
  so there is no external recipient to consent to. Tier 2 needs no acknowledgement.
- **No surprise sends** (mirrors *reconnect on reload; no surprise connections*): nothing
  goes to a provider until one is configured and acknowledged, and then only when the user
  actually asks the navigator a question. shirube never pings a provider on its own.
- **Always-visible destination.** The navigator shows where it is pointed at all times —
  the provider name, or "local — nothing leaves this machine" — so the user is never unsure
  who is receiving their schema. Switching to a *different* hosted provider re-triggers the
  one-time acknowledgement (a new external recipient).
- The per-turn **"preview exactly what will be sent"** panel stays a later transparency
  enhancement (see *external-send privacy*); the M2 flow is the upfront explanation plus the
  persistent destination indicator.

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

### More database engines

- PostgreSQL is the only supported target for the beta. Broadening to **SQLite**
  (local, file-based — a natural fit for the local-first, read-only stance) and **MySQL**
  is planned. This is the database being *explored*, distinct from shirube's own SQLite
  state file. Each engine needs its own inspection + data-reader adapter behind the
  existing ports, and the read-only and safety guarantees must hold for every one.
