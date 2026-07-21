/** Shared configuration for the end-to-end run: the seeded database and the served app. */

const DATABASE_URL =
  process.env.SHIRUBE_E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'

const url = new URL(DATABASE_URL)

/** How to reach the seeded database — the values the test types into the form. */
export const DB = {
  connectionString: DATABASE_URL,
  host: url.hostname,
  port: url.port || '5432',
  database: url.pathname.replace(/^\//, '') || 'postgres',
  username: decodeURIComponent(url.username) || 'postgres',
  password: decodeURIComponent(url.password) || 'postgres',
}

/**
 * A dedicated schema for the fixtures, so the map is deterministic no matter what else
 * the target database holds (an empty CI service, or a dev box with other data).
 */
export const SCHEMA = 'shirube_e2e'

/** Port the e2e server binds to — deliberately not the default 7472, so a dev instance
 *  left running never collides with (or gets reused instead of) the test's own server. */
export const PORT = '7473'

/** Where the built app is served during the run. */
export const BASE_URL = `http://127.0.0.1:${PORT}`

/** Port for the stub OpenAI-compatible provider the navigator test points at (see
 *  `stub-provider.mjs`) — it passes the reachability check but serves no real model. */
export const STUB_PROVIDER_PORT = '59998'

/** Base URL the navigator test configures as its provider. */
export const STUB_PROVIDER_URL = `http://127.0.0.1:${STUB_PROVIDER_PORT}/v1`
