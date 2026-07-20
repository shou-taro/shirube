/**
 * Where the AI navigator sends the schema, and which destinations the user has agreed to.
 *
 * The navigator talks straight from this machine to the configured provider, so before any
 * schema metadata leaves for a *remote* endpoint the user consents once. That consent is
 * remembered per destination — a trusted-destinations list the user can review and revoke in
 * Settings — so it never nags. A loopback endpoint (a local model) reaches nothing off the
 * machine and so is trusted implicitly, without ever asking.
 *
 * What is stored is only an identifier for a destination (`anthropic`, `openai:<host>`);
 * credentials never appear here — an API key lives in the OS keychain and is held by the
 * backend alone.
 */

import type { AiProvider } from '@/lib/api'
import { TRUSTED_DESTINATIONS_KEY } from '@/lib/storage'

/** Hostnames that mean "this machine"; these never need consent. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

/** Where a configured provider sends the schema, described for the UI and trust decisions. */
export interface Destination {
  /** Stable identifier used to remember trust — `anthropic`, or `openai:<host>` for a URL. */
  id: string
  /** Short label to show: a provider name or the endpoint's host. */
  label: string
  /** The network host reached, or null when the base URL is absent or unparseable. */
  host: string | null
  /** True when the endpoint is this machine (loopback) — local destinations never ask. */
  isLocal: boolean
}

/** The hostname of a base URL, or null when it is empty or cannot be parsed. */
function hostOf(baseUrl: string | null): string | null {
  if (!baseUrl) {
    return null
  }
  try {
    return new URL(baseUrl).hostname
  } catch {
    return null
  }
}

/** Describe where the given provider sends the schema. */
export function describeDestination(provider: AiProvider): Destination {
  if (provider.kind === 'anthropic') {
    return { id: 'anthropic', label: 'Claude', host: 'api.anthropic.com', isLocal: false }
  }
  const host = hostOf(provider.base_url)
  return {
    id: host !== null ? `openai:${host}` : `openai:${provider.base_url ?? ''}`,
    label: host ?? (provider.base_url || 'OpenAI-compatible'),
    host,
    isLocal: host !== null && LOOPBACK_HOSTS.has(host),
  }
}

/** A readable label for a stored destination identifier, for the Settings list. */
export function labelForDestinationId(id: string): string {
  if (id === 'anthropic') {
    return 'Claude'
  }
  return id.startsWith('openai:') ? id.slice('openai:'.length) : id
}

/**
 * Read the trusted destination identifiers from storage, tolerating a missing or malformed
 * value. These are endpoint identifiers only — never credentials.
 */
export function loadTrustedDestinations(): string[] {
  try {
    const raw = localStorage.getItem(TRUSTED_DESTINATIONS_KEY)
    if (raw === null) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function saveTrustedDestinations(ids: string[]): void {
  localStorage.setItem(TRUSTED_DESTINATIONS_KEY, JSON.stringify(ids))
}

/** Remember that the user agreed the navigator may send the schema to this destination. */
export function trustDestination(id: string): string[] {
  const ids = loadTrustedDestinations()
  if (ids.includes(id)) {
    return ids
  }
  const next = [...ids, id]
  saveTrustedDestinations(next)
  return next
}

/** Forget a previously trusted destination, so it will ask again next time. */
export function forgetDestination(id: string): string[] {
  const next = loadTrustedDestinations().filter((existing) => existing !== id)
  saveTrustedDestinations(next)
  return next
}

/** Whether the schema may be sent to this destination without asking — local, or trusted. */
export function isDestinationTrusted(destination: Destination, trusted: string[]): boolean {
  return destination.isLocal || trusted.includes(destination.id)
}
