import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type ChatStreamEvent,
  clearAiProvider,
  createProfile,
  deleteProfile,
  fetchAiProvider,
  fetchHealth,
  fetchRows,
  fetchSchema,
  listProfiles,
  saveAiProvider,
  streamChat,
  testConnection,
  testProfileConnection,
  updateProfile,
} from '@/lib/api'

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

  it('reads the AI provider, returning null when unconfigured', async () => {
    const spy = mockFetch(new Response('null', { status: 200 }))

    await expect(fetchAiProvider()).resolves.toBeNull()
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('/api/ai/provider')
  })

  it('PUTs the AI provider config', async () => {
    const spy = mockFetch(
      new Response(
        JSON.stringify({
          kind: 'openai_compatible',
          model: 'llama3.1',
          base_url: 'http://localhost:11434/v1',
          has_api_key: false,
        }),
        { status: 200 },
      ),
    )

    await saveAiProvider({
      kind: 'openai_compatible',
      model: 'llama3.1',
      base_url: 'http://localhost:11434/v1',
    })

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/ai/provider')
    expect(init.method).toBe('PUT')
  })

  it('DELETEs the AI provider', async () => {
    const spy = mockFetch(new Response(null, { status: 204 }))

    await expect(clearAiProvider()).resolves.toBeUndefined()
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/ai/provider')
    expect(init.method).toBe('DELETE')
  })

  it('lists profiles', async () => {
    const spy = mockFetch(new Response('[]', { status: 200 }))

    await expect(listProfiles()).resolves.toEqual([])
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('/api/profiles')
  })

  it('PUTs a profile update', async () => {
    const spy = mockFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

    await updateProfile('p1', {
      name: 'n',
      host: 'h',
      port: 5432,
      database: 'd',
      username: 'u',
      sslmode: 'require',
      schemas: [],
    })

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/profiles/p1')
    expect(init.method).toBe('PUT')
  })

  it('POSTs an ad-hoc connection test', async () => {
    const spy = mockFetch(new Response(null, { status: 204 }))

    await testConnection({
      host: 'h',
      port: 5432,
      database: 'd',
      username: 'u',
      password: 'p',
      sslmode: 'require',
    })

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/connections/test')
    expect(init.method).toBe('POST')
  })

  it("POSTs a saved profile's connection test", async () => {
    const spy = mockFetch(new Response(null, { status: 204 }))

    await testProfileConnection('p1')

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/profiles/p1/test')
    expect(init.method).toBe('POST')
  })

  it('fetches a schema', async () => {
    const spy = mockFetch(
      new Response(JSON.stringify({ objects: [], relationships: [] }), { status: 200 }),
    )

    await expect(fetchSchema('p1')).resolves.toEqual({ objects: [], relationships: [] })
    expect((spy.mock.calls[0] as unknown as [string])[0]).toBe('/api/profiles/p1/schema')
  })
})

/** Build a streaming Response whose body emits each string as its own chunk. */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, { status })
}

async function collect(events: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = []
  for await (const event of events) {
    out.push(event)
  }
  return out
}

describe('streamChat', () => {
  it('posts the messages and yields the parsed SSE events', async () => {
    const spy = mockFetch(
      sseResponse([
        'event: tool_call\ndata: {"name": "search_objects"}\n\n',
        'event: text\ndata: {"text": "The store table."}\n\n',
        'event: done\ndata: {"usage": {"input_tokens": 12, "output_tokens": 3}}\n\n',
      ]),
    )

    const events = await collect(
      streamChat('p1', [{ role: 'user', content: 'Where do stores live?' }]),
    )

    expect(events).toEqual([
      { type: 'tool_call', name: 'search_objects' },
      { type: 'text', text: 'The store table.' },
      { type: 'done', usage: { input_tokens: 12, output_tokens: 3 } },
    ])
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/profiles/p1/chat')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ messages: [{ role: 'user', content: 'Where do stores live?' }] }))
  })

  it('reassembles a frame split across chunk boundaries', async () => {
    mockFetch(sseResponse(['event: text\nda', 'ta: {"text": "hi"}\n\nevent: done\ndata: {}\n\n']))

    const events = await collect(streamChat('p1', [{ role: 'user', content: 'hi' }]))

    expect(events[0]).toEqual({ type: 'text', text: 'hi' })
    expect(events[1]).toEqual({ type: 'done', usage: { input_tokens: null, output_tokens: null } })
  })

  it("rejects before streaming with the backend's translated detail", async () => {
    mockFetch(new Response(JSON.stringify({ detail: 'No AI provider is configured.' }), { status: 400 }))

    await expect(collect(streamChat('p1', [{ role: 'user', content: 'hi' }]))).rejects.toThrow(
      'No AI provider is configured.',
    )
  })

  it('yields an error frame', async () => {
    mockFetch(sseResponse(['event: error\ndata: {"message": "unreachable"}\n\n']))

    const events = await collect(streamChat('p1', [{ role: 'user', content: 'hi' }]))

    expect(events).toEqual([{ type: 'error', message: 'unreachable' }])
  })

  it('skips frames with an unknown event or no data', async () => {
    mockFetch(
      sseResponse([
        'event: mystery\ndata: {}\n\n', // unknown event name → dropped
        ': just a comment\n\n', // no event/data lines → dropped
        'event: text\ndata: {"text": "kept"}\n\n',
      ]),
    )

    const events = await collect(streamChat('p1', [{ role: 'user', content: 'hi' }]))

    expect(events).toEqual([{ type: 'text', text: 'kept' }])
  })

  it('yields nothing when the response has no body', async () => {
    mockFetch(new Response(null, { status: 200 }))

    await expect(collect(streamChat('p1', [{ role: 'user', content: 'hi' }]))).resolves.toEqual([])
  })

  it('stops and releases the stream when the caller breaks early', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: text\ndata: {"text": "one"}\n\n'))
        // Left open, so only a cancel ends it.
      },
      cancel() {
        cancelled = true
      },
    })
    mockFetch(new Response(stream, { status: 200 }))

    for await (const event of streamChat('p1', [{ role: 'user', content: 'hi' }])) {
      expect(event).toEqual({ type: 'text', text: 'one' })
      break // Exits the generator, running its finally.
    }

    expect(cancelled).toBe(true)
  })
})
