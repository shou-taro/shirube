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

/** What an edge represents: a foreign key, or a view reading a relation. */
export type RelationshipKind = 'foreign_key' | 'view_dependency'

/** A relationship — one edge on the map. Foreign keys carry joined columns; view
 *  dependencies have none. */
export interface Relationship {
  constraint_name: string
  /** `schema.name` id of the referencing object (the view, for a dependency). */
  source: string
  source_columns: string[]
  /** `schema.name` id of the referenced object. */
  target: string
  target_columns: string[]
  kind: RelationshipKind
}

/** The introspected schema: objects (nodes) and relationships (edges). */
export interface SchemaGraph {
  objects: SchemaObject[]
  relationships: Relationship[]
}

/** How a row filter compares a column against a value. `is_null`/`is_not_null` ignore it. */
export type FilterOperator = 'eq' | 'ne' | 'contains' | 'is_null' | 'is_not_null'

/** Ascending or descending order for a sorted column. */
export type SortDirection = 'asc' | 'desc'

/** One filter condition on a row query; conditions combine with AND. */
export interface RowFilter {
  column: string
  operator: FilterOperator
  value?: string
}

/** How to order a row query. */
export interface RowSort {
  column: string
  direction: SortDirection
}

/** A request for a page of an object's rows. */
export interface RowQuery {
  limit?: number
  offset?: number
  sort?: RowSort | null
  filters?: RowFilter[]
}

/** A single cell's value, reduced to something JSON can carry. */
export type CellValue = string | number | boolean | null

/** One page of rows read back from an object. */
export interface RowPage {
  columns: string[]
  rows: CellValue[][]
  /** Whether a further page exists past this one. */
  has_more: boolean
  offset: number
  limit: number
}

/** Which adapter talks to the configured AI provider. */
export type AiProviderKind = 'anthropic' | 'openai_compatible'

/** The configured AI provider as returned by the API — never the API key. */
export interface AiProvider {
  kind: AiProviderKind
  model: string
  /** Where to reach the API; `null` for Anthropic's default endpoint. */
  base_url: string | null
  /** Whether an API key is stored in the keychain (the key itself is never returned). */
  has_api_key: boolean
}

/** Fields sent when configuring the provider; omit `api_key` to keep the stored one. */
export interface AiProviderInput {
  kind: AiProviderKind
  model: string
  base_url?: string | null
  api_key?: string | null
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

/** Fetch the configured AI provider, or `null` when none is set. */
export function fetchAiProvider(): Promise<AiProvider | null> {
  return apiFetch<AiProvider | null>('/ai/provider')
}

/** Configure the AI provider; omit `api_key` to keep the stored one. */
export function saveAiProvider(input: AiProviderInput): Promise<AiProvider> {
  return apiFetch<AiProvider>('/ai/provider', { method: 'PUT', body: JSON.stringify(input) })
}

/** Unconfigure the AI provider and remove any stored API key. */
export function clearAiProvider(): Promise<void> {
  return apiFetch<void>('/ai/provider', { method: 'DELETE' })
}

/** Read a filtered, sorted page of one table or view's rows. */
export function fetchRows(
  profileId: string,
  objectId: string,
  query: RowQuery,
): Promise<RowPage> {
  return apiFetch<RowPage>(`/profiles/${profileId}/objects/${encodeURIComponent(objectId)}/rows`, {
    method: 'POST',
    body: JSON.stringify(query),
  })
}

/** One user-facing message of the navigator conversation. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Token counts the provider reported for a turn, when available. */
export interface TokenUsage {
  input_tokens: number | null
  output_tokens: number | null
}

/**
 * One event streamed back from the navigator: a chunk of answer text, a marker that it
 * looked something up, the final done (with token usage), or an error message. Mirrors the
 * Server-Sent Events frames the chat endpoint emits.
 */
export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string }
  | { type: 'done'; usage: TokenUsage }
  | { type: 'error'; message: string }

/** Parse one SSE frame (its `event:` and `data:` lines) into a typed event, or null. */
function parseChatFrame(frame: string): ChatStreamEvent | null {
  let name = ''
  let data = ''
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      name = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      data = line.slice('data:'.length).trim()
    }
  }
  if (name === '' || data === '') {
    return null
  }
  const payload = JSON.parse(data) as Record<string, unknown>
  switch (name) {
    case 'text':
      return { type: 'text', text: String(payload.text ?? '') }
    case 'tool_call':
      return { type: 'tool_call', name: String(payload.name ?? '') }
    case 'done':
      return {
        type: 'done',
        usage: (payload.usage as TokenUsage | undefined) ?? {
          input_tokens: null,
          output_tokens: null,
        },
      }
    case 'error':
      return { type: 'error', message: String(payload.message ?? '') }
    default:
      return null
  }
}

/**
 * Ask the navigator a question and stream its reply.
 *
 * Yields each Server-Sent Event as it arrives (see {@link ChatStreamEvent}). A request made
 * before a provider is configured — or any other pre-stream failure — rejects with the
 * backend's translated `detail`, exactly as {@link apiFetch} does; failures *during* the
 * answer arrive as a final `error` event instead. Pass an `AbortSignal` to stop mid-stream;
 * aborting rejects the iteration with an `AbortError`, which the caller can treat as a
 * deliberate stop rather than a failure.
 */
export async function* streamChat(
  profileId: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch(`/api/profiles/${profileId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  })
  if (!response.ok) {
    throw new Error(await errorDetail(response))
  }
  if (response.body === null) {
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      // SSE frames are terminated by a blank line; process each complete one.
      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        const event = parseChatFrame(buffer.slice(0, separator))
        buffer = buffer.slice(separator + 2)
        if (event !== null) {
          yield event
        }
        separator = buffer.indexOf('\n\n')
      }
    }
  } finally {
    // Release the stream on early exit (an abort, or the caller breaking the loop).
    await reader.cancel().catch(() => undefined)
  }
}
