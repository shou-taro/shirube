# Testing strategy

shirube is tested in layers. Each layer owns what only it can verify, and security
guarantees are treated as **first-class tests**, not incidental ones — for a tool that
advertises "read-only" and "local-first", a regression in a guarantee is a
vulnerability, not a bug.

## The layers

| Layer | Owns | Tooling | Dependencies |
| --- | --- | --- | --- |
| **Backend unit** | Logic, branching, transforms, validation, error translation, SQL *construction* | pytest | none (fakes) |
| **Backend integration** | Whether the SQL is *correct against a real PostgreSQL* — introspection, row reads, the read-only guarantee | pytest + a real Postgres | real DB |
| **Frontend unit / component** | Pure logic and each component's behaviour (props/state → render, interaction) | Vitest + React Testing Library (jsdom) | none (fetch mocked) |
| **End-to-end** | Cross-layer wiring and critical journeys through the whole stack | Playwright | built SPA + backend + DB |

## What goes where

The dividing rule:

- **Unit** — anything whose inputs → outputs can be enumerated: pure functions, edge
  cases, validation, data mapping, the SQL a builder emits, a component's behaviour given
  props and state.
- **Integration** — the *truth against real infrastructure*: does this SQL return the
  right rows from a real database, does introspection read the right catalogue, does the
  repository round-trip?
- **End-to-end** — the things that only break once every layer is connected: routing, the
  SPA reaching the API, the ER canvas drawing real introspected data, a full journey.

Two rules that keep the pyramid healthy:

- **Never verify business logic through e2e.** It is slow, flaky, and can't enumerate
  cases — push the logic down to a unit test.
- **Never verify database truth through mocks.** A faked cursor proves nothing about the
  real SQL — that belongs in integration.

## Backend

### Unit (pytest, no database)

- `build_graph` — rows → schema graph: kind mapping, dropping edges to unknown objects,
  view-dependency assembly.
- `build_select` — SQL composition: parameterisation, each operator, sort, `limit + 1`,
  rejection of an unknown column.
- `_cell` serialisation — `None` / `bool` / `bytes` / `Decimal` / `datetime` reduced to
  JSON-safe values.
- `friendly_message` — each `sqlstate` → translated, actionable message.
- Route models and translation — `RowQueryInput.to_query`, `RowPageRead.from_page`,
  `ObjectRead.from_domain`, exercised through `TestClient` with fake adapters.
- Services (`SchemaService`, `DataService`, `ProfileService`, `ConnectionService`) with
  fake repositories / secret store / inspector — profile-not-found, password wiring.
- Middleware — host validation, security headers, metadata-only request logging.
- Config — defaults, `SHIRUBE_*` overrides, `_is_loopback`, allowed-hosts composition.

### Integration (pytest + a real PostgreSQL)

This is where the SQL-emitting adapters are proven; the unit tests above feed them canned
rows and cannot.

- `PostgresSchemaInspector.inspect()` — objects, columns, primary keys, foreign keys and
  view dependencies read correctly from a real schema.
- `PostgresDataReader.read_rows()` — execution, each filter operator, sorting, paging and
  `has_more`, unknown object → 404, unknown column → 400, `bytea` rendering, identifier
  quoting for awkward names.
- `read_only_connection` / the connector — a successful connect, and that a write is
  actually refused and `statement_timeout` actually fires (see *Security testing*).
- The SQLAlchemy profile repository — CRUD round-trips against a throwaway SQLite file.

The keyring adapter stays faked (CI has no keychain).

## Frontend

### Unit and component (Vitest + React Testing Library)

- **Pure logic** — `lib/api` (error-detail parsing, 204, URL/encoding), `lib/settings`
  (default merge, invalid-JSON fallback, applying the `dark` class), `er/layout.ts` (node
  height/size, dashed view-dependency edges, off-map stub computation — the maths behind
  the earlier minimap bug), neighbourhood/adjacency computation.
- **Components** — `data-drawer` (NULL rendering, sort cycling asc → desc → off, filter
  add/remove/update, paging enablement and offset, **reset on centre change**),
  `table-detail` (section collapse, references / referenced-by split), `schema-search`
  (filtering, ⌘K, selection), `kind-badge`, `settings-dialog`, `connection-form`
  (validation, submit payload).

React Flow's *rendering* can't be measured under jsdom, so it is verified end-to-end; its
*layout maths* (`er/layout.ts`) is pure and stays here.

## End-to-end (Playwright)

A handful of journeys against the built SPA, a real backend and a sample database:

1. Connect → the **ER diagram renders** → the detail panel shows the centre table's
   columns.
2. Travel (click a neighbour / search a table) → the map recentres and the detail updates.
3. Data preview → open the drawer → rows load → sort a column → add a filter that narrows
   → page.
4. ⌘K search → jump to a table.
5. Settings → dark theme recolours the app; toggling view dependencies changes the edges;
   **a reload reconnects to the last profile**.
6. (Optional) a bad connection surfaces a translated error.

**Do not** put in e2e: every filter operator (integration/unit), component branching
(frontend unit), fine-grained SQL correctness (integration), or third-party behaviour
(dagre, React Flow internals).

## Security testing (first-class)

Ordinary tests assert that good things happen; **security tests assert that bad things do
not** — under adversarial input, and as regression guards. shirube advertises specific
guarantees, so each one gets a test that proves it, kept in a named suite
(`test_security.py` plus its integration counterpart).

| Guarantee | The test that proves it (mostly adversarial / negative) | Layer |
| --- | --- | --- |
| **Read-only** | A real connection refuses `INSERT`/`UPDATE`/`CREATE`; multiple statements can't run; `statement_timeout` actually aborts a slow query | integration |
| **Safe SQL construction** | Hostile input in `object_id`, column names and filter values (`"`, `;`, `--`, `DROP`, backslashes, Unicode) causes no injection and no error leak — rejected by the whitelist or bound as a parameter; proven against a real DB | integration + unit |
| **Credentials never leak** | A password never appears in an API response, the log, the SQLite file, or an error message — only the keychain holds it | unit |
| **Metadata-only logging** | A request carrying a distinctive filter value / row content — assert those never appear in the log | unit |
| **Local-first / anti-rebinding** | Host-header validation, the security headers, and that **no CORS header is ever emitted** (a regression guard); a smoke check on the real server | unit + e2e |
| **No internal leakage** | On an unexpected error the client receives only the translated `detail` — never a stack trace, raw SQL or connection string | unit |

The SQL builder and its validation have a wide input space, so a **property test**
(Hypothesis) that throws many adversarial strings at `build_select` and the column
whitelist is a high-leverage addition.

## Security automation in CI

Tests are one pillar; a security-serious project also automates supply-chain and static
checks:

- **Dependency audit** — `pip-audit` (uv) and `pnpm audit`, so a vulnerable dependency
  fails CI. Non-negotiable for a tool that handles database credentials.
- **Static analysis (SAST)** — Bandit for Python security lints; the security rules of
  oxlint/eslint for the frontend; **CodeQL** once the repository is public (free there).
- **Secret scanning** — GitHub secret scanning and/or gitleaks, so credentials can't be
  committed.
- **Dependabot** — automated dependency-update PRs.
- Already in place: pinned lockfiles (`uv.lock`, `pnpm-lock.yaml`, `--frozen-lockfile`),
  `SECURITY.md`, host validation and CSP. **Branch protection + required checks** come
  once the repository is public (unavailable on a private Free-plan repo).

## Test data

- **Integration** — a small, deterministic seed schema, so rows can be asserted exactly
  and tests stay fast.
- **End-to-end** — pagila (via `scripts/dev-db.sh`): realistic, with views, materialised
  views, partitions and foreign keys.

CI gains a `postgres` service. Integration tests are marked `@pytest.mark.integration` so
a machine without a database can skip them; e2e runs as a separate job (build → serve →
Playwright). E2e is the slowest and flakiest layer, so it is kept minimal and run in CI /
before a release rather than on every change.

## Priorities

Highest value first — security invariants lead, because they protect the product's
central claims:

1. **Read-only enforcement** and the **SQL-injection** adversarial tests (integration).
2. Credential / log-leak negative tests and the CORS regression guard (unit).
3. CI `pip-audit` / `pnpm audit` and Bandit (then CodeQL, Dependabot, secret scanning
   once public).
4. A property test over `build_select` and validation.

Alongside these, fill the functional gaps in the order **frontend unit → backend
integration → e2e** (frontend has the widest gap and the fastest feedback; e2e is the
capstone).

## Out of scope for now

A dedicated fuzzing harness, SBOM signing / build provenance, and a third-party
penetration test are deferred — appropriate once shirube is public and has users, not for
the beta.
