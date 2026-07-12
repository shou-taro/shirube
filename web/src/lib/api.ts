/**
 * Typed client for the Shirube backend API.
 *
 * In development these requests are proxied to the backend by the Vite dev server
 * (see `vite.config.ts`); in a packaged build the backend serves the SPA, so they hit
 * the same origin directly. Either way the frontend only ever talks to `/api/*`.
 */

/** Shape of the {@link fetchHealth} response. */
export interface HealthResponse {
  /** Always `"ok"` when the server can answer. */
  status: string
  /** The running backend version. */
  version: string
}

/**
 * Check that the backend is reachable.
 *
 * @returns The parsed health payload.
 * @throws Error if the request fails or the server responds with a non-2xx status.
 */
export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health')
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`)
  }
  return (await response.json()) as HealthResponse
}
