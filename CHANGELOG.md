# Changelog

All notable changes to shirube are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and shirube
aims to follow [Semantic Versioning](https://semver.org/) (pre-1.0, so the API and UI
may still change between releases).

## [Unreleased]

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

[Unreleased]: https://github.com/shou-taro/shirube/compare/v0.1.0b1...HEAD
[0.1.0b1]: https://github.com/shou-taro/shirube/releases/tag/v0.1.0b1
