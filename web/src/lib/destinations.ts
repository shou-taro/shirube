/**
 * Where the AI navigator sends the schema, and which destinations the user has agreed to.
 *
 * The navigator talks straight from this machine to the configured provider, so before any
 * schema metadata leaves for a *remote* endpoint the user consents once. That consent is
 * remembered per destination — a trusted-destinations list the user can review and revoke in
 * Settings — so it never nags. A loopback endpoint (a local model) reaches nothing off the
 * machine and so is trusted implicitly, without ever asking.
 */

import type { AiProvider } from '@/lib/api'
import { TRUSTED_DESTINATIONS_KEY } from '@/lib/storage'

/** Hostnames that mean "this machine"; these never need consent. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

/** Where a configured provider sends the schema, described for the UI and trust decisions. */
export interface Destination {
  /** Stable key used to remember trust — `anthropic`, or `openai:<host>` for a URL endpoint. */
  key: string
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
    return { key: 'anthropic', label: 'Claude', host: 'api.anthropic.com', isLocal: false }
  }
  const host = hostOf(provider.base_url)
  return {
    key: host !== null ? `openai:${host}` : `openai:${provider.base_url ?? ''}`,
    label: host ?? (provider.base_url || 'OpenAI-compatible'),
    host,
    isLocal: host !== null && LOOPBACK_HOSTS.has(host),
  }
}

/** A readable label for a stored trust key, for the Settings list. */
export function labelForTrustKey(key: string): string {
  if (key === 'anthropic') {
    return 'Claude'
  }
  return key.startsWith('openai:') ? key.slice('openai:'.length) : key
}

/** Read the trusted-destination keys from storage, tolerating a missing or malformed value. */
export function loadTrustedDestinations(): string[] {
  try {
    const raw = localStorage.getItem(TRUSTED_DESTINATIONS_KEY)
    if (raw === null) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []
  } catch {
    return []
  }
}

function saveTrustedDestinations(keys: string[]): void {
  localStorage.setItem(TRUSTED_DESTINATIONS_KEY, JSON.stringify(keys))
}

/** Remember that the user agreed the navigator may send the schema to this destination. */
export function trustDestination(key: string): string[] {
  const keys = loadTrustedDestinations()
  if (keys.includes(key)) {
    return keys
  }
  const next = [...keys, key]
  saveTrustedDestinations(next)
  return next
}

/** Forget a previously trusted destination, so it will ask again next time. */
export function forgetDestination(key: string): string[] {
  const next = loadTrustedDestinations().filter((key_) => key_ !== key)
  saveTrustedDestinations(next)
  return next
}

/** Whether the schema may be sent to this destination without asking — local, or trusted. */
export function isDestinationTrusted(destination: Destination, trusted: string[]): boolean {
  return destination.isLocal || trusted.includes(destination.key)
}
