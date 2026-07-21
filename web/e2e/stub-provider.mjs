// A stub OpenAI-compatible provider for the navigator end-to-end test.
//
// It answers the reachability check the settings run before saving — GET /v1/models — so a
// provider pointed at it can be configured, but it serves no real model: a chat completion
// fails, which the navigator surfaces as an error in the conversation. That exercises the
// whole stack (settings check, save, chat route, tool loop, provider adapter, SSE, pane)
// right up to where a real model would answer, without needing one in CI.
import { createServer } from 'node:http'

const PORT = Number(process.env.STUB_PROVIDER_PORT || 59998)

const server = createServer((req, res) => {
  const url = req.url ?? ''

  // The reachability check: report one model so the check passes and the provider can save.
  if (req.method === 'GET' && url.startsWith('/v1/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] }))
    return
  }

  // Reachable, but there is no real model here — fail so the navigator reports an error.
  if (req.method === 'POST' && url.startsWith('/v1/chat/completions')) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'no model is served here' } }))
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`stub OpenAI-compatible provider listening on 127.0.0.1:${PORT}`)
})
