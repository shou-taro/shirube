/**
 * Typed client for the shirube backend API.
 *
 * In development these requests are proxied to the backend by the Vite dev server
 * (see `vite.config.ts`); in a packaged build the backend serves the SPA, so they hit
 * the same origin directly. Either way the frontend only ever talks to `/api/*`.
 *
 * Failed requests reject with an `Error` whose message is the backend's translated
 * `detail`, so callers can show it to the user directly.
 */

/** Shape of the {@link fetchHealth} response. */
export interface HealthResponse {
  /** Always `"ok"` when the server can answer. */
  status: string
  /** The running backend version. */
  version: string
}

/** PostgreSQL SSL negotiation mode. */
export type SslMode = 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

/** A saved connection profile (non-secret fields only). */
export interface Profile {
  id: string
  name: string
  host: string
  port: number
  database: string
  username: string
  sslmode: SslMode
  schemas: string[]
}

/** Fields sent when creating or updating a profile; `password` may be omitted on edit. */
export interface ProfileInput {
  name: string
  host: string
  port: number
  database: string
  username: string
  password?: string
  sslmode: SslMode
  schemas: string[]
}

/** Ad-hoc parameters for a connection test (before a profile is saved). */
export interface ConnectionTestParams {
  host: string
  port: number
  database: string
  username: string
  password: string
  sslmode: SslMode
}

/** The kind of schema object shown on the ER map. */
export type ObjectKind = 'table' | 'view' | 'materialized_view'

/** A column of a table or view. */
export interface Column {
  name: string
  data_type: string
  nullable: boolean
  is_primary_key: boolean
}

/** A table, view or materialized view — one node on the map. */
export interface SchemaObject {
  /** Stable `schema.name` identifier. */
  id: string
  schema: string
  name: string
  kind: ObjectKind
  columns: Column[]
}

/** A foreign-key relationship — one edge on the map. */
export interface Relationship {
  constraint_name: string
  /** `schema.name` id of the referencing object. */
  source: string
  source_columns: string[]
  /** `schema.name` id of the referenced object. */
  target: string
  target_columns: string[]
}

/** The introspected schema: objects (nodes) and relationships (edges). */
export interface SchemaGraph {
  objects: SchemaObject[]
  relationships: Relationship[]
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string }
    if (body.detail) {
      return body.detail
    }
  } catch {
    // Body was not JSON; fall through to a generic message.
  }
  return `Request failed (${response.status})`
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    throw new Error(await errorDetail(response))
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

/** Check that the backend is reachable. */
export function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health')
}

/** List all saved connection profiles. */
export function listProfiles(): Promise<Profile[]> {
  return apiFetch<Profile[]>('/profiles')
}

/** Create a profile; the password is stored in the OS keychain. */
export function createProfile(input: ProfileInput): Promise<Profile> {
  return apiFetch<Profile>('/profiles', { method: 'POST', body: JSON.stringify(input) })
}

/** Update a profile; omit `password` to keep the stored one. */
export function updateProfile(id: string, input: ProfileInput): Promise<Profile> {
  return apiFetch<Profile>(`/profiles/${id}`, { method: 'PUT', body: JSON.stringify(input) })
}

/** Delete a profile and its stored password. */
export function deleteProfile(id: string): Promise<void> {
  return apiFetch<void>(`/profiles/${id}`, { method: 'DELETE' })
}

/** Test ad-hoc connection parameters; rejects with the translated message on failure. */
export function testConnection(params: ConnectionTestParams): Promise<void> {
  return apiFetch<void>('/connections/test', { method: 'POST', body: JSON.stringify(params) })
}

/** Test a saved profile's connection, using its stored password. */
export function testProfileConnection(id: string): Promise<void> {
  return apiFetch<void>(`/profiles/${id}/test`, { method: 'POST' })
}

/** Introspect a saved profile's database and return its schema as a graph. */
export function fetchSchema(id: string): Promise<SchemaGraph> {
  return apiFetch<SchemaGraph>(`/profiles/${id}/schema`)
}
