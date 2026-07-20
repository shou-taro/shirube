import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type ChatStreamEvent,
  clearAiProvider,
  createProfile,
  deleteProfile,
  fetchAiProvider,
  fetchHealth,
  fetchRows,
  saveAiProvider,
  streamChat,
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
})
