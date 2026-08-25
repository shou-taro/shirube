/**
 * A `fetch` interceptor that lets the real Explorer run with no backend.
 *
 * The landing-page demo mounts shirube's actual `<Explorer>` unchanged; this stands in for
 * the server it would otherwise call, answering `/api/*` from the bundled Chinook fixtures.
 * Everything the map needs — schema, a page of rows, drawing manual links — is served
 * locally; the AI navigator needs a real model, so it is reported unconfigured (its empty
 * state markets the feature and points to the real app). Non-`/api` requests pass straight
 * through to the browser's real fetch.
 */
import type { RowFilter, RowQuery } from '@/lib/api'

import schema from './chinook-schema.json'
import rowsData from './chinook-rows.json'

const DEMO_PROFILE = {
  kind: 'sqlite',
  id: 'demo',
  name: 'Sample database (Chinook)',
  path: 'chinook.sqlite',
  schemas: [],
}

type Rows = Record<string, { columns: string[]; rows: (string | number | boolean | null)[][] }>

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let manualSeq = 0

function matchesFilter(cell: string | number | boolean | null, filter: RowFilter): boolean {
  switch (filter.operator) {
    case 'is_null':
      return cell === null
    case 'is_not_null':
      return cell !== null
    case 'eq':
      return String(cell) === (filter.value ?? '')
    case 'ne':
      return String(cell) !== (filter.value ?? '')
    case 'contains':
      return String(cell ?? '').toLowerCase().includes((filter.value ?? '').toLowerCase())
    default:
      return true
  }
}

function compare(a: string | number | boolean | null, b: string | number | boolean | null): number {
  if (a === null) return b === null ? 0 : -1
  if (b === null) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/** Serve a page of a table's rows, honouring the query's filter, sort and paging. */
function rowsResponse(objectId: string, query: RowQuery): Response {
  const table = (rowsData as Rows)[objectId]
  const limit = query.limit ?? 50
  const offset = query.offset ?? 0
  if (!table) {
    return json({ columns: [], rows: [], has_more: false, offset, limit })
  }
  const { columns } = table
  let rows = table.rows

  for (const filter of query.filters ?? []) {
    const ci = columns.indexOf(filter.column)
    if (ci < 0) continue
    rows = rows.filter((row) => matchesFilter(row[ci], filter))
  }
  if (query.sort) {
    const ci = columns.indexOf(query.sort.column)
    if (ci >= 0) {
      const dir = query.sort.direction === 'desc' ? -1 : 1
      rows = [...rows].sort((a, b) => compare(a[ci], b[ci]) * dir)
    }
  }
  const page = rows.slice(offset, offset + limit)
  return json({ columns, rows: page, has_more: offset + limit < rows.length, offset, limit })
}

/** Answer one `/api/...` request (path already stripped of the `/api` prefix). */
function handle(path: string, method: string, body: unknown): Response | null {
  if (path === '/health') return json({ status: 'ok', version: 'demo' })
  if (path === '/profiles' && method === 'GET') return json([DEMO_PROFILE])
  if (/^\/profiles\/[^/]+\/schema$/.test(path)) return json(schema)
  if (path === '/ai/provider' && method === 'GET') return json(null)

  if (/^\/profiles\/[^/]+\/relationships$/.test(path) && method === 'POST') {
    return json({ ...(body as object), id: `demo-manual-${++manualSeq}` })
  }
  if (/^\/profiles\/[^/]+\/relationships\/[^/]+$/.test(path) && method === 'DELETE') {
    return json(undefined, 204)
  }
  const rowsMatch = path.match(/^\/profiles\/[^/]+\/objects\/([^/]+)\/rows$/)
  if (rowsMatch && method === 'POST') {
    return rowsResponse(decodeURIComponent(rowsMatch[1]), (body ?? {}) as RowQuery)
  }
  // Any AI configuration attempt: the navigator is not wired up in the demo.
  if (path.startsWith('/ai/provider')) {
    return json(
      { detail: 'The AI navigator is not available in the demo — install shirube to use it.' },
      400,
    )
  }
  return null
}

/** Wrap `window.fetch` so `/api/*` is answered locally; call once before the app mounts. */
export function installApiMock(): void {
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
    const parsed = new URL(url, location.origin)
    if (!parsed.pathname.startsWith('/api/')) {
      return realFetch(input, init)
    }
    const path = parsed.pathname.slice(4) // drop the leading '/api'
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase()
    let body: unknown
    const raw = init?.body
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw)
      } catch {
        body = undefined
      }
    }
    return handle(path, method, body) ?? json({ detail: 'Not available in the demo.' }, 404)
  }
}
