# Design decisions

Why shirube is built the way it is. The point of this record is the *why* — so that
future contributors and maintainers can understand a trade-off instead of re-opening it.

It has two parts:

- **Decided** — settled choices that shape the shipped product.
- **Tentative** — current thinking on parts **not yet built** (further database engines
  and deferred navigator enhancements). Design intent, not commitments; expect it to change
  once the code exists.

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
- The guarantee holds **per engine**: PostgreSQL runs a read-only transaction; SQLite
  opens the file `mode=ro` and caps statements against a time budget (see *Multiple
  database engines* below).

### Local web-surface hardening

**Built.**

- shirube serves a local HTTP API, so its real exposure is **browser-driven**, not a
  missing login — a login screen would be theatre for a single-user localhost tool.
- **Host-header validation** (only loopback names + the bind host) is the core defence
  against **DNS rebinding**, where a page on another origin points its own hostname at
  `127.0.0.1` to reach the API through the browser. This is why loopback binding alone is
  not enough.
- Plus same-origin **security headers** (CSP, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`). The bind address is **fixed to loopback and not configurable** —
  there is no supported way to expose shirube on the network, so an unauthenticated API
  can't be put there by accident. Reach a remote instance over an SSH tunnel instead.
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

**Built (tables/views/matviews/partitioned tables; foreign-key, view-dependency and
manual edges).**

- **Nodes:** tables, views, materialised views, and **partitioned tables** (shown as one
  node — see below). Indexes, constraints, triggers, types, sequences and comments belong
  **in the detail panel, not as nodes**. Out of scope (not a DBA tool): roles, extensions,
  tablespaces.
- **A partitioned table folds into a single node.** It stands in for the whole table; its
  child partitions are **folded away** rather than scattered across the map, and are listed
  in the detail panel's *Partitions* section (name + bound). This keeps a partition-heavy
  schema readable. A folded design was chosen over an on-map expand/collapse — the children
  are an implementation detail of the one logical table, not places to travel to. A foreign
  key declared on a **child** partition is re-attributed to the parent, so the parent node's
  edges are complete even when the database records them per child.
- **Edges** are visually distinct by meaning: **foreign-key** (declared, solid),
  **view-dependency** (a view → the relations it reads, dashed) and **manual** (dotted).
  Manual links are built: a user draws the relationship the database does not declare,
  column to column, so foreign-key-less schemas stop scattering on the map. They are saved
  per profile and never touch the target database, and are styled apart from the other two.
- Relationships are drawn from **declared foreign keys**. **Rule-based name inference is
  rejected:** on legacy schemas its accuracy is unpredictable, and a *wrong* edge
  misleads worse than a missing one. If inference ever returns, it should be "the AI
  proposes, the user confirms", verified against real data.
- Deferred: foreign tables; functions/procedures (they don't fit the "node with columns"
  model).

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
  is (see *AI: external-send privacy*).
- For views, the definition SQL is de-emphasised — dependencies and output columns first.

### Local persistence: SQLite, keyed to profiles

**Built.**

- shirube's own state is a single **SQLite** file in the OS data directory
  (`platformdirs`); secrets stay in the keychain. Chosen over JSON/TOML for being
  structured and transactional as the data grows, and it reuses SQLAlchemy. (This is
  shirube's *own* state, distinct from a SQLite database a user connects to and explores —
  see *Multiple database engines*.)
- Per-database state is keyed to the **profile**, not host+port+database — SSH tunnels
  make every database look like `localhost:5432`, so a user-named profile disambiguates.
  The **manual links a user draws are persisted this way**, as is each connection's
  **navigator conversation**; the ER map's layout is **not** persisted, and there is no
  plan to — the map is laid out afresh each session.

### Schema introspection: fresh per connect, drift-tolerant

**Built.**

- Re-introspected on each connect and held in memory for the session — **no persistent
  schema cache** (introspection is fast; this avoids stale, misleading metadata). A
  manual "refresh" covers mid-session changes. Read from `pg_catalog` (or SQLite's
  `sqlite_master` / `PRAGMA` introspection) as lightweight structures, not full ORM
  reflection.
- On drift: layout for vanished tables is skipped; a manual link whose endpoint has since
  vanished — a renamed or dropped table, or one outside the currently selected schemas — is
  kept in storage but simply not drawn, so it reappears on its own if the object returns
  (for instance the schema is re-included). Surfacing such links for review ("needs
  attention") is intended but not yet built.

### Reconnect on reload; no surprise connections otherwise

**Built (revised).**

- First launch (no profiles) opens the connection form; otherwise the saved-profiles
  list. shirube reconnects to the **last-used profile on reload**, so a refresh doesn't
  drop the user back to the connection screen — but it never connects to a *new* database
  without the user choosing it. Sample databases are available for development via
  `scripts/dev-db.sh`, and a bundled Chinook sample ships as a ready-made profile (see *A
  bundled sample database*).
- *(Revised: originally "never auto-connects on launch"; restoring the last profile on
  reload proved worth it, and it is scoped to the profile the user last chose.)*

### Multiple schemas on one map

**Built.**

- One profile = one database (matches PostgreSQL; browsing another means another
  profile). Schemas chosen at connect time share one map, with schema-qualified names and
  cross-schema foreign keys drawn; system schemas are excluded by default.

### Multiple database engines: dialect adapters behind kind-tagged connections

**Built (PostgreSQL, SQLite); committed (MySQL).**

- PostgreSQL shipped first; **SQLite** (local, file-based — the natural fit for the
  local-first, read-only stance) is now built, and **MySQL** is the next committed engine.
  This is the database being *explored*, distinct from shirube's own SQLite state file.
- The ports (`SchemaInspector`, `DataReader`, `DatabaseConnector`) were already
  engine-neutral in **shape**; what leaked PostgreSQL was the **data flowing through them** —
  `ConnectionProfile` / `ConnectionParams` assumed a server (host / port / user / password /
  sslmode). So the connection model was generalised **before** the first SQLite adapter, not
  after — otherwise server assumptions would have scattered through the domain, persistence,
  ports, adapters and the connection form, to be unpicked later.
- Each engine has its own inspection + data-reader + connector adapter behind the shared
  ports; a **factory picks the adapter by kind** (mirrors `adapters/ai/factory.py`, so the
  application layer never names a concrete engine), and a per-request dispatcher routes to
  the engine matching the connection's kind. The read-only and safety guarantees —
  read-only open, forced `LIMIT`, statement timeout, no DML/DDL — hold for every engine.

### Connection model: kind-tagged, so a file path is a first-class connection

**Built.**

- A `DatabaseKind` (`postgresql`, `sqlite`, later `mysql`) tags each profile, which carries
  the **common** parts (id, name, kind) plus a **kind-specific target**:
  - PostgreSQL / MySQL: host, port, database, username, SSL settings (+ password in the
    keychain).
  - SQLite: a **single file path** — no host, port, user, password or SSL.
- A **discriminated union** (a typed target per kind) was chosen over one wide profile with
  every field nullable: a SQLite profile is structurally unable to hold a stray port, and
  the `kind` tells both the form and the adapter factory what to expect. `sslmode` lives on
  the server-kinds' target, out of the common shape.
- **Secrets:** SQLite has no password, so it stores nothing in the keychain — the same "some
  connections carry no secret" shape already accepted for local AI models (Ollama needs no
  key). `SecretStore` is unchanged; a SQLite profile simply has no entry.
- **Persistence:** the app-state `profiles` table gained a `kind` column (default
  `postgresql` for existing rows) and room for the SQLite target — a lightweight *additive*
  migration in bootstrap. Pre-1.0 local state, so add-a-column was enough; no migration
  framework.
- **Frontend:** the connection form is kind-aware — choose the engine, then see only that
  engine's fields (a file picker for SQLite, with a native "Browse…" dialog and a
  type-the-path fallback; the server fields for PostgreSQL). "Test connection" works per
  engine. A saved SQLite connection shows its file name, with the full path on hover.

### Schema-less engines: map onto `main`, keep object ids unchanged

**Built (SQLite).**

- Object ids are `schema.name` throughout — the ER map, the look-up tools, `find_path`, and
  the data reader's `object_id`. SQLite has no schemas (one namespace, whose real name *is*
  `main`); MySQL's "database" is itself the namespace.
- **Decision: do not special-case the id format.** For SQLite the schema is its genuine
  `main`; for MySQL it is the database name. This keeps the entire object-id surface — map,
  `get_object`, `find_path`, `read_rows`, schema-qualified labels — **unchanged**, which is
  the whole point: a new engine is an adapter, not a rewrite of the core.
- The connect-time "choose schemas" step **collapses to the single namespace** for
  schema-less engines (auto-selected, selector hidden); `list_schemas()` returns the one
  entry; cross-schema FK drawing never triggers. Introspection reads SQLite's `sqlite_master`
  / `PRAGMA foreign_key_list` into the same `SchemaGraph` the map already consumes.

### A bundled sample database: try shirube with no Docker

**Built (Chinook).**

- The Docker pagila sample is great for contributors, but **without Docker there was
  nothing to try on the spot**. SQLite closes that: a small sample database ships *in the
  product* so `uvx shirube` lands the user in an explorable schema immediately, as a **saved
  connection that is already there**.
- **Dataset: Chinook** — SQLite's canonical sample (a music store: Artist → Album → Track →
  InvoiceLine → Invoice → Customer, plus a self-referencing Employee). Its foreign keys make
  the ER map and the navigator demo well; it is small (~1 MB) and permissively licensed
  (MIT — © 2008–2024 Luis Rocha; bundled unmodified with its notice in
  `api/src/shirube/samples/CHINOOK-LICENSE.txt`). A SQLite build of Sakila/pagila (parity
  with the Postgres sample) was the alternative; Chinook won as the native SQLite convention
  and lighter. The Docker/pagila PostgreSQL sample **stays** — the "real server DB" example
  for development.
- **Provisioning — copied to a stable user-data path on first run, not read from the
  wheel.** `uvx` runs from an ephemeral venv whose path changes each invocation, so a profile
  pointing into `site-packages` would break next run. Instead the `.sqlite` ships as package
  data and is **copied once** into the `platformdirs` data directory (beside the app-state
  file); the seeded profile points at that stable path, so it keeps working across `uvx` runs
  and installs.
- **Auto-seed — once, idempotent, read-only, and it respects deletion.** On startup, if the
  sample has never been seeded (a **one-time marker**, *not* "are there no profiles"), the
  file is copied if absent and a "Sample database (Chinook)" profile is added. If the user
  **deletes** it, it does **not** come back — the marker prevents nagging. The sample opens
  **read-only** (SQLite `mode=ro`), consistent with the read-only safety model.
  `SHIRUBE_SEED_SAMPLE=false` opts out entirely.
- **"No surprise connections" still holds.** Seeding a *profile* is not *connecting*: the
  sample appears in the saved list, but shirube still connects only when the user picks it
  (see *Reconnect on reload; no surprise connections*). This augments *Local-first,
  single-command distribution*, where Docker Compose was the bundled-sample option — the
  bundled sample is now zero-dependency, and Docker becomes specifically the PostgreSQL one.

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
  the map. Conceptual look-ups ("where is 売上?") are the AI navigator's job, not an
  embedding index here.

### AI navigator: foundation first, then the navigator

**Built.**

- **Milestone 1 — Foundation** (connection, schema, ER, detail, data preview, search,
  navigation) shipped first as a public beta; **Milestone 2 — the AI navigator**, the
  feature shirube is ultimately built around, followed, layered on Milestone 1's schema
  look-up tools. Releasing the foundation first got real-world feedback and de-risked the AI
  work. Both are now shipped; the explorer works fully without the navigator, which is
  entirely optional.

### AI navigator: metadata only, proposes, never auto-executes

**Built.**

- The navigator reasons over **schema metadata only** (names, types, PK/FK, comments,
  counts) and **proposes**; a human clicks to run. It never executes SQL itself — resolving
  "answer where sales lives" against "never feel dangerous", and keeping data values away
  from the AI. It is a *navigator, not a SQL generator*.

### AI navigator: model tiers and provider abstraction

**Built.**

- Two ways bring intelligence to the navigator:
  1. **Bring your own API key** — a hosted provider the user already pays for (Claude, or
     any OpenAI-compatible endpoint).
  2. **Local model** — a model running on the user's own machine (Ollama and other
     OpenAI-compatible local runners), for full privacy.
- Both keep shirube's core promise: no shirube backend, calls go straight from the user's
  machine to their chosen provider or local model, and only question-relevant metadata
  leaves (a local model leaves nothing).
- **Two provider adapters** behind one internal interface (`adapters/ai/`):
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
- Adapters expose only what the navigator needs — a chat turn with tool-calling — so adding
  an engine later is a new adapter rather than a rewrite.

### AI navigator: provider config and key handling

**Built.**

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

### AI navigator: schema via look-up tools

**Built.**

- The navigator is not handed the whole schema (hundreds of tables blow the context window
  and cost). It has **tools** to look things up on demand and pulls in only what a question
  needs — scaling to thousands of tables and minimising what is sent externally. Semantic
  (embedding-based) retrieval remains a later enhancement.

### AI navigator: the look-up tool set

**Built.**

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
- Cross-object **path finding** is the `find_path` tool above (backend BFS over the
  relationship graph — fast and reliable regardless of schema size); answers render the hop
  sequence as **clickable text hops**, which is the intended form. A *visual* route overlay
  drawn across the diagram is **not planned**: the map is a neighbourhood view (one centre
  plus its one-hop neighbours), so a multi-hop path rarely fits on screen at once, and
  drawing it would mean abandoning the travel model. Clicking the hops walks the same route
  within that model.
- The set **assumes a function-calling-capable model** (see *model tiers*), and that is a
  deliberate line: a no-tool degraded path — packing a guessed, question-relevant metadata
  slice straight into the prompt for models that can't call tools — is **not planned**. It
  would mean a permanent second retrieval architecture for a narrowing niche, and a model too
  weak to call tools is generally too weak for the navigator anyway.

### AI navigator: external-send privacy

**Built.**

- **Data values never leave the machine.** No default provider ships; the user configures
  one (Claude, an OpenAI-compatible API, *or* local Ollama — see *model tiers and provider
  abstraction* above), and that choice is the consent. Only question-relevant schema
  metadata is sent, and only to the chosen provider; a local model stays fully local. A
  "preview what will be sent" is a later transparency feature.

### AI navigator: the consent flow

**Built.**

- **Choosing a hosted provider is the consent — and it is an informed one.** The first time
  a hosted provider (tier 1) is configured, shirube states plainly, in one place, what it
  will and won't send: it sends the **question, the running conversation, and
  question-relevant schema metadata** (table/column names, types, keys, comments,
  relationship structure, row-count estimates) to that provider; it **never** sends row data
  or column values. The user acknowledges once, and that is the record of consent.
- **Local models skip it** — Ollama and other local runners send nothing off the machine,
  so there is no external recipient to consent to. Tier 2 needs no acknowledgement.
- **No surprise sends** (mirrors *reconnect on reload; no surprise connections*): nothing
  goes to a provider until one is configured and acknowledged, and then only when the user
  actually asks the navigator a question. shirube never pings a provider on its own.
- **Always-visible destination.** The navigator shows where it is pointed at all times —
  the provider name, or "local — nothing leaves this machine" — so the user is never unsure
  who is receiving their schema. Switching to a *different* hosted provider re-triggers the
  one-time acknowledgement (a new external recipient).
- The per-turn **"preview exactly what will be sent"** panel remains a later transparency
  enhancement (see *external-send privacy*); the shipped flow is the upfront explanation plus
  the persistent destination indicator.

### AI navigator: answers wired to the map

**Built.**

- Table names in an answer are clickable and move/highlight the map, so the AI and the map
  feel like one navigator. Path questions are answered in text with **clickable hops** — the
  intended form. Drawing a *path* across the diagram (e.g. Customer → Orders → Payments) as a
  visual route planner is **not planned**: it conflicts with the neighbourhood-travel map,
  where a multi-hop path rarely fits on screen at once (see *the look-up tool set*).

### AI navigator: per-profile history and token display

**Built.**

- Conversations are scoped to the profile and persisted in SQLite (revisit prior Q&A;
  new/clear available). Token usage is shown from the provider; there is no built-in
  currency conversion (pricing drifts and misleads); Ollama shows "local, no API cost".

### AI navigator: the pane (UI)

**Built.**

- The right pane is the working navigator: docked, slid open/closed from the top-bar
  Sparkles toggle, with the lilac pane styling.
- **Composer.** A real, multi-line input — Enter sends, Shift+Enter for a newline; the send
  button enables when there is text and becomes a **stop** control while a request is in
  flight. When no provider is configured yet, the composer prompts to set one up (a link
  into provider settings) rather than sitting dead.
- **Conversation.** A centred intro shows only when the thread is empty; otherwise a
  scrollable list of turns — the user's question and the AI's streamed answer — scoped and
  persisted per profile (see *per-profile history*), with new/clear.
- **Answers wired to the map.** Table names and `find_path` hops render as clickable chips
  that recentre/highlight the map (see *answers wired to the map*); a visual route overlay is
  not planned.
- **Pane header** carries the always-visible **destination indicator** (provider name, or
  "local — nothing leaves") from the consent flow, a way into provider settings, and token
  usage per the *token display* decision (a local model shows "local, no API cost").
- **Width.** The pane (like the table-detail pane) is **resizable by dragging**, and the
  chosen width is remembered.

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

Design intent for parts **not yet built**. Recorded so the thinking isn't lost, but expect
it to change once implemented.

### MySQL engine

- The next database engine after PostgreSQL and SQLite. It slots into the kind-tagged
  connection model and the adapter factory already in place (see *Multiple database
  engines* and *Connection model* under Decided): a new inspection + data-reader + connector
  adapter behind the shared ports, a `mysql` `DatabaseKind` with a server-shaped target
  (host / port / database / user / password + SSL, password in the keychain), and a form
  case. Its "database" is the namespace, mapped like SQLite's `main` so the object-id
  surface stays unchanged. The read-only and safety guarantees must hold as for the other
  engines.

### Full interface localisation

- Ship a **fully localised UI** (Japanese first). The i18n layer is already in place (see
  *UI language: English base with i18n* under Decided) and every string routes through it, so
  this is translation and review work rather than plumbing: supply the dictionaries and add a
  language switcher. English stays the canonical base. (The docs already carry a native
  Japanese README; the *app* UI is still English-only for now.)

### Deferred navigator enhancements

- **Per-turn send preview** — a panel showing exactly what metadata a question will send
  before it leaves, on top of the upfront consent and always-visible destination (see *the
  consent flow*). Design tension to settle first: because the navigator is **tool-calling**,
  the full payload isn't known upfront — only the first turn (question + history + tool
  definitions) is; the metadata slices are decided turn-by-turn as the model calls the
  look-up tools. So a true "before it leaves" preview can only cover the first turn, and the
  realistic shape is either a first-turn preview or a **per-turn transmission log** (what
  actually went out, after each turn), or a hybrid. Pin this down before building.
- **Semantic retrieval** — embedding-based look-up to complement the deterministic
  `search_objects` entry point.
