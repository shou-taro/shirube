import { afterEach, describe, expect, it, vi } from 'vitest'

import { createProfile, deleteProfile, fetchHealth, fetchRows } from '@/lib/api'

const originalFetch = globalThis.fetch

/** Replace `fetch` with one that always answers `response`, and return the spy. */
function mockFetch(response: Response) {
  const spy = vi.fn(async () => response)
  globalThis.fetch = spy as unknown as typeof fetch
  return spy
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('a successful request', () => {
  it('parses and returns the JSON body', async () => {
    mockFetch(new Response(JSON.stringify({ status: 'ok', version: '1.2.3' }), { status: 200 }))

    await expect(fetchHealth()).resolves.toEqual({ status: 'ok', version: '1.2.3' })
  })

  it('resolves to undefined on 204 without parsing a body', async () => {
    mockFetch(new Response(null, { status: 204 }))

    await expect(deleteProfile('abc')).resolves.toBeUndefined()
  })
})

describe('a failed request', () => {
  it("rejects with the backend's translated detail", async () => {
    mockFetch(new Response(JSON.stringify({ detail: 'Database unreachable.' }), { status: 400 }))

    await expect(fetchHealth()).rejects.toThrow('Database unreachable.')
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    mockFetch(new Response('<html>oops</html>', { status: 500 }))

    await expect(fetchHealth()).rejects.toThrow('Request failed (500)')
  })

  it('falls back when the JSON error carries no detail', async () => {
    mockFetch(new Response(JSON.stringify({ error: 'nope' }), { status: 422 }))

    await expect(fetchHealth()).rejects.toThrow('Request failed (422)')
  })
})

describe('request shape', () => {
  it('percent-encodes the object id and posts the query for fetchRows', async () => {
    const spy = mockFetch(
      new Response(
        JSON.stringify({ columns: [], rows: [], has_more: false, offset: 0, limit: 100 }),
        { status: 200 },
      ),
    )

    await fetchRows('p1', 'public.my table', { limit: 10 })

    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/profiles/p1/objects/public.my%20table/rows')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ limit: 10 }))
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('posts to the profiles endpoint when creating a profile', async () => {
    const spy = mockFetch(new Response(JSON.stringify({ id: 'x' }), { status: 201 }))

    await createProfile({
      name: 'n',
      host: 'h',
      port: 5432,
      database: 'd',
      username: 'u',
      password: 'p',
      sslmode: 'require',
      schemas: [],
    })

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/profiles')
    expect(init.method).toBe('POST')
  })
})
