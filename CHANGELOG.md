# Changelog

All notable changes to shirube are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and shirube
aims to follow [Semantic Versioning](https://semver.org/) (pre-1.0, so the API and UI
may still change between releases).

## [Unreleased]

### Changed

- **The AI model field suggests real models.** In Settings → AI navigator, the model field
  now suggests the models your provider actually offers — a boon for a local Ollama, whose
  model tags are easy to mistype. Focus the field to fetch the list; it stays a plain text
  field, so any model (including one not listed) still works, and it falls back to typing if
  the provider can't list its models.
- **The navigator's answers read clean.** The navigator used to prepend every "I'll look at
  X" note it made along the way to its answer, so a well-connected table produced a
  repetitive run-up before the point. Those look-up steps now sit collapsed above the answer
  (expand to see what it consulted), leaving just the final answer as the body.

### Fixed

- **Data preview paging no longer repeats or skips rows.** Row previews now page in a stable
  order — by primary key, falling back to SQLite's `rowid` — so moving between pages can no
  longer show a row twice or miss one when no sort, or a non-unique sort, is applied.
- **The AI navigator is told the right database engine.** On a SQLite connection the navigator
  described the database to the model as PostgreSQL; it now names the actual engine (or a
  neutral "database").

### Security

- **AI send-consent is scoped to the exact endpoint.** Approving a remote AI provider was
  remembered by hostname alone, so changing that endpoint's scheme, port or path — including
  HTTPS to plain HTTP — silently reused the old approval. Consent is now keyed to the full
  destination, so any such change asks again. Existing approvals are re-confirmed once.

## [0.3.0b2] — 2026-07-30

### Added

- **Explore SQLite databases.** shirube now reads SQLite database files as well as
  PostgreSQL. Choose the engine when adding a connection, then point shirube at a `.sqlite`
  file — it opens read-only, just like a PostgreSQL connection.
- **A built-in sample database.** On first run shirube adds a ready-to-explore
  "Sample database (Chinook)" connection — a small SQLite music-store schema — so you can
  try the map with no database of your own and no Docker. It is read-only, seeded once, and
  never comes back if you delete it. Set `SHIRUBE_SEED_SAMPLE=false` to opt out.
- **Pick a SQLite file with a dialog.** The connection form's SQLite path field now has a
  "Browse…" button that opens a native file dialog to choose the database file. Where a
  dialog isn't available, it falls back to typing the path in the field.

### Changed

- **SQLite connections show their file name.** A saved SQLite connection now displays its
  file name (e.g. `chinook.sqlite`) rather than its full path, with the full path on hover.

## [0.3.0b1] — 2026-07-28

### Added

- **Draw your own relationships.** When a database does not declare a foreign key — common
  in ORM-shaped, legacy or warehouse schemas — shirube can't tell that two tables are
  related, so no edge links them and you can't travel between them. You can now draw the
  missing link yourself: hover a column in the detail card, choose the target
  column from a searchable tree (a `<name>_id` column suggests its likely table), and a
  manual edge is drawn as a dotted line — set apart from the solid foreign keys and dashed
  view dependencies — tagged in the detail card and removable. The links are saved per
  connection and never touch your database.
- **Japanese README.** shirube's README is now available in Japanese
  ([`README.ja.md`](README.ja.md)), linked from the top of the English one.

## [0.2.0b7] — 2026-07-27

### Added

- **Browse the schema as a tree.** A new toolbar button opens a collapsible tree of the
  whole database — schemas, then their tables and views, each expandable to its columns
  (primary and foreign keys marked). Click any object to travel the map to it while the tree
  stays open; the map's current table is highlighted in step. It reads the schema the map
  already has, so it complements the map and search without a fresh request — and comes into
  its own on a database with several schemas.

### Fixed

- **Three more connection failures now read clearly** instead of a raw "could not connect".
  A missing role is named as a username problem (distinct from a wrong password); a server
  that is at its connection limit says so ("too many clients"); and a server that is up but
  still starting up or recovering advises waiting and retrying.
- **Clickable controls show a pointer cursor.** Buttons and select dropdowns across the app
  (the data preview, the navigator, the detail pane, the schema tree and the top bar) now
  show a pointer on hover, rather than reading as plain text.

## [0.2.0b6] — 2026-07-24

### Added

- **The workspace adapts to a narrow window.** In a narrow or half-screen window the AI
  navigator now slides in over the map (dimming and blurring it) instead of squeezing the
  map's width, so the map stays usable; the table-detail card is kept within the viewport
  and the top bar drops the database label first as space runs short.

### Changed

- **Scrollbars now match the app.** Scroll areas (the detail card, navigator, data preview
  and menus) use a slim, brand-tinted, floating scrollbar in place of the chunky operating-
  system default, in both light and dark themes.

### Fixed

- **The navigator no longer sends mid-conversion for IME input.** Pressing Enter to confirm
  a Japanese (or other IME) conversion committed the candidate *and* sent the message; it now
  commits only, and sends on a subsequent plain Enter.

## [0.2.0b5] — 2026-07-23

### Fixed

- **A partitioned table no longer looks disconnected.** When a partitioned table's foreign
  keys are declared on its child partitions rather than the parent (as pagila's `payment`
  is), the map now attaches those relationships to the parent instead of dropping them with
  the hidden children — so the table shows its links, each once, like any other.
- **A view that reads a partitioned table now shows the dependency.** The dashed link from a
  view or materialized view to a partitioned table it reads was being dropped (pagila's
  `rental_by_category` reads the partitioned `payment`); it is now drawn like any other view
  dependency.

## [0.2.0b4] — 2026-07-23

### Added

- **Partitioned tables read as one.** A partitioned table now shows as a single node on the
  map — badged *Partitioned* — instead of scattering its child partitions across it. The
  detail card gains a **Partitions** section listing each child and the range, list or hash it
  holds, and the table's data preview reads across every partition, exactly like any other
  table.

### Changed

- **Hub tables stay readable.** A table with many relationships no longer stacks all its
  neighbours into an unreadable vertical strip: the map now draws up to six per direction and
  folds the rest into the off-map stub above and below it. That stub is now a button — click it
  to see the folded tables listed by name and travel to any one. Nothing is lost; the detail
  card still lists every relationship too.

## [0.2.0b3] — 2026-07-23

### Added

- **A context window for local models.** A local or custom OpenAI-compatible provider (such as
  Ollama) now takes a context-window setting in **Settings → AI navigator**, so the navigator
  knows how much room the model has, seeded with a conservative default. Claude and hosted
  OpenAI, whose windows are always large, are handled automatically and show no field.

### Changed

- **The navigator keeps its conversation inside the model's context window.** Older turns are
  trimmed to fit before a question is sent, and a turn that would still overrun stops with a
  clear message rather than a failed request — so a long conversation, or a small local model,
  no longer breaks the navigator.

### Documentation

- Refreshed the README badges: the build status now reads from the CI workflow, and the row
  gains the supported Python versions and a Ruff badge.

## [0.2.0b2] — 2026-07-21

### Changed

- The AI provider is now verified before it is saved: a wrong base URL, an unreachable model
  server or a rejected API key is reported in **Settings → AI navigator** straight away,
  rather than only surfacing when the navigator is first asked a question. The check lists
  the provider's models, so it costs no tokens.

### Added

- A navigator error (for example, the provider could not be reached) now carries a warning
  icon, so a failed answer reads as an error at a glance.

### Documentation

- Reworked the README and PyPI page: the hero now shows the whole tool at once — the
  navigator, the ER map, a table's detail and a filtered data preview — and the copy reframes
  the pitch around understanding the schema you write less SQL against by hand.

## [0.2.0b1] — 2026-07-21

The AI navigator lands — the feature shirube is built around. Ask a database a question in
plain language and shirube answers on the map, lighting up the tables involved. The
explorer from the 0.1 betas is unchanged; this release opens the 0.2 line by adding the
navigator alongside it.

### Added

- **AI navigator.** Ask in plain language and get an answer *on the map*: the navigator
  reads your schema metadata to guide you, streams its reply as it goes, and lights up the
  tables involved. Every object name in the answer is a link that flies the map to it. It
  is a *navigator, not a SQL generator* — it never writes or runs a query.
- **Bring your own model.** Configure a provider in **Settings → AI navigator** — your own
  Claude or OpenAI key, or a local OpenAI-compatible model such as Ollama. Keys are kept in
  the OS keychain, never in a config file. The navigator is entirely optional; the explorer
  works fully without it.
- **Per-connection conversations.** Each saved connection keeps its own navigator history,
  restored when you return to it, with the token usage shown for every answer and a one-tap
  clear.
- **Resizable panes.** The table-detail and navigator panes can be dragged to the width you
  want, and the size is remembered.

### Security

- **Straight to your provider.** A navigator request goes directly from your machine to the
  model you chose — nothing routes through a shirube server. Only the schema metadata
  relevant to your question is sent, and a local model sends nothing off your machine at
  all. The navigator reads metadata to guide you; it never runs or writes SQL.
- **One-time consent per destination.** Before your schema first reaches a remote provider,
  shirube asks you to confirm that destination and remembers the choice; a local (loopback)
  model needs no confirmation.

### Documentation

- Rewrote the README around the navigator: two ways to read a database (steer the map, or
  ask), the model and privacy story, and a two-phase roadmap.

## [0.1.0b4] — 2026-07-19

### Fixed

- Connecting to a database with no tables no longer shows a "select a table" prompt in the
  detail card alongside the centre's "no tables or views found" message — the empty state
  now reads cleanly.

## [0.1.0b3] — 2026-07-19

### Changed

- The connection screen's tagline now reads "Read your database as a map." The AI
  navigator is still the next milestone, so the beta no longer describes itself as
  understanding your database "with AI".

### Fixed

- Search now ranks an exact name match ahead of a longer partial match: searching a table
  name surfaces that table first, rather than an alphabetically-earlier table that merely
  contains the text (e.g. `store` now leads `sales_by_store`).

## [0.1.0b2] — 2026-07-19

The first beta was rough around the edges; this release smooths the connection and
start-up experience, hardens error handling, and improves keyboard and screen-reader
access. No new features — the AI navigator is still the next milestone.

### Changed

- Enriched the PyPI package metadata — project URLs (Homepage, Repository, Changelog,
  Issues) and trove classifiers — and added a PyPI version badge to the README.
- PyPI releases are now published automatically from a GitHub release via Trusted
  Publishing (OIDC), rather than by hand.

### Fixed

- The browser now opens only once the server is accepting connections, instead of after
  a fixed one-second delay — a slow cold start no longer greets you with a "cannot
  connect" page.
- The connection form's **Test** button now checks the required fields itself (it sits
  outside the form's own validation), naming just the ones left blank rather than failing
  with a cryptic driver error.
- Clearer messages for two connection failures: an empty host (which quietly falls back
  to a local socket) and a missing password on a server that requires one.
- **Save and connect** now verifies the connection before opening the explorer, so a bad
  host or password surfaces on the form — as it does for **Test** — instead of dropping
  you onto the map with an error. Connecting a saved connection from the list verifies the
  same way, showing a spinner while it checks.
- A query cancelled by the statement timeout (e.g. previewing a very large table) now
  reads as a timeout with advice to narrow the work, rather than a misleading "could not
  connect".
- OS keychain failures (a locked or unavailable keychain, or access denied) now surface as
  a clear message instead of an unhandled error, and a keychain write failure while
  creating a connection rolls the connection back rather than leaving it saved without a
  password.
- Starting shirube when its port is already in use now prints a clear message and exits,
  instead of an obscure bind error — and no longer opens the browser onto whatever else is
  listening there.

### Accessibility

- Data-preview column headers are now real buttons: sorting is reachable and operable by
  keyboard (Enter / Space), and the sort state is announced via `aria-sort`.
- The table/column search is now a proper ARIA combobox — its expanded state and the
  highlighted result are exposed to assistive technology, and the field has an accessible
  name.
- The settings dialog now manages focus: it moves focus inside on open, keeps Tab within
  the dialog, and restores focus to the opener on close.
- Fixed the data-preview filter's operator dropdown, which announced itself as "contains"
  regardless of the selected operator; it now reads as "Operator".

## [0.1.0b1] — 2026-07-17

The first public beta: shirube's explorer core. The AI navigator — the feature shirube
is ultimately built around — is the next milestone and is **not** in this release.

### Added

- **Connections.** Connect to a PostgreSQL database and save several named profiles;
  passwords are kept in the operating system's keychain, never in a config file.
- **ER diagram home.** An automatically generated diagram centred on the most-connected
  table, with neighbourhood *travel* navigation — a table and its one-hop neighbours,
  moving outward as you go.
- **Table detail.** Columns with their types, primary keys and nullability, plus
  relationships (foreign keys and view dependencies) split into *references* and
  *referenced by*.
- **Relationship navigation.** Click a related table to travel the map to it.
- **Data preview.** Read a table or view's rows in a drawer beneath the map, with
  click-to-sort columns, simple column filters and paging.
- **Search.** Jump to any table or column with <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd>.
- **Appearance & settings.** Light and dark themes, and a settings panel.
- **Diagnostic logging.** A local, structured, metadata-only log beside the app-state
  database, to make failures diagnosable — colourised lines on the console and one JSON
  object per line in the file, with a per-request `request_id` (also returned in the
  `X-Request-ID` header).

### Security

- **Read-only by design.** Every connection is opened read-only with a statement
  timeout; shirube issues no writes or schema changes.
- **Local-first.** The server binds to `127.0.0.1` only; database credentials and data
  never leave the machine, and passwords live in the OS keychain.
- **Metadata-only logging.** The log never records filter values, row data or passwords.

[Unreleased]: https://github.com/shou-taro/shirube/compare/v0.3.0b1...HEAD
[0.3.0b1]: https://github.com/shou-taro/shirube/compare/v0.2.0b7...v0.3.0b1
[0.2.0b7]: https://github.com/shou-taro/shirube/compare/v0.2.0b6...v0.2.0b7
[0.2.0b6]: https://github.com/shou-taro/shirube/compare/v0.2.0b5...v0.2.0b6
[0.2.0b5]: https://github.com/shou-taro/shirube/compare/v0.2.0b4...v0.2.0b5
[0.2.0b4]: https://github.com/shou-taro/shirube/compare/v0.2.0b3...v0.2.0b4
[0.2.0b3]: https://github.com/shou-taro/shirube/compare/v0.2.0b2...v0.2.0b3
[0.2.0b2]: https://github.com/shou-taro/shirube/compare/v0.2.0b1...v0.2.0b2
[0.2.0b1]: https://github.com/shou-taro/shirube/compare/v0.1.0b4...v0.2.0b1
[0.1.0b4]: https://github.com/shou-taro/shirube/compare/v0.1.0b3...v0.1.0b4
[0.1.0b3]: https://github.com/shou-taro/shirube/compare/v0.1.0b2...v0.1.0b3
[0.1.0b2]: https://github.com/shou-taro/shirube/compare/v0.1.0b1...v0.1.0b2
[0.1.0b1]: https://github.com/shou-taro/shirube/releases/tag/v0.1.0b1
