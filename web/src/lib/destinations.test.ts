import { afterEach, describe, expect, it } from 'vitest'

import type { AiProvider } from '@/lib/api'
import {
  describeDestination,
  revokeDestination,
  isDestinationApproved,
  labelForDestinationId,
  loadApprovedDestinations,
  approveDestination,
} from '@/lib/destinations'

function provider(patch: Partial<AiProvider>): AiProvider {
  return { kind: 'openai_compatible', model: 'm', base_url: null, has_api_key: false, ...patch }
}

afterEach(() => {
  localStorage.clear()
})

describe('describeDestination', () => {
  it('describes Claude as a remote, hosted destination', () => {
    const destination = describeDestination(provider({ kind: 'anthropic', base_url: null }))
    expect(destination).toEqual({
      id: 'anthropic',
      label: 'Claude',
      host: 'api.anthropic.com',
      isLocal: false,
    })
  })

  it('treats a loopback endpoint as local', () => {
    const destination = describeDestination(provider({ base_url: 'http://localhost:11434/v1' }))
    expect(destination.isLocal).toBe(true)
    expect(destination.host).toBe('localhost')
    expect(destination.id).toBe('openai:localhost')
  })

  it('treats a remote OpenAI-compatible endpoint as hosted, keyed by host', () => {
    const destination = describeDestination(
      provider({ base_url: 'https://mac-studio.example.ts.net:8443/v1' }),
    )
    expect(destination.isLocal).toBe(false)
    expect(destination.host).toBe('mac-studio.example.ts.net')
    expect(destination.id).toBe('openai:mac-studio.example.ts.net')
  })

  it('handles a missing base URL without a host', () => {
    const destination = describeDestination(provider({ base_url: null }))
    expect(destination.host).toBeNull()
    expect(destination.isLocal).toBe(false)
    expect(destination.label).toBe('OpenAI-compatible')
  })

  it('handles an unparseable base URL without a host', () => {
    const destination = describeDestination(provider({ base_url: 'not a url' }))
    expect(destination.host).toBeNull()
    expect(destination.isLocal).toBe(false)
    // Falls back to the raw value for the label and a stable key.
    expect(destination.label).toBe('not a url')
    expect(destination.id).toBe('openai:not a url')
  })
})

describe('approval store', () => {
  it('remembers and forgets destinations, ignoring duplicates', () => {
    expect(loadApprovedDestinations()).toEqual([])
    const one = approveDestination([], 'anthropic')
    expect(one).toEqual(['anthropic'])
    // A repeat approval does not duplicate the entry.
    expect(approveDestination(one, 'anthropic')).toEqual(['anthropic'])
    const two = approveDestination(one, 'openai:host')
    expect(two).toEqual(['anthropic', 'openai:host'])
    // Each change is persisted, so a reload sees the same list.
    expect(loadApprovedDestinations()).toEqual(['anthropic', 'openai:host'])
    expect(revokeDestination(two, 'anthropic')).toEqual(['openai:host'])
    expect(loadApprovedDestinations()).toEqual(['openai:host'])
  })

  it('tolerates a malformed stored value', () => {
    localStorage.setItem('shirube.approvedDestinations', 'not json')
    expect(loadApprovedDestinations()).toEqual([])
  })
})

describe('isDestinationApproved', () => {
  it('approves a local destination without any stored consent', () => {
    const local = describeDestination(provider({ base_url: 'http://127.0.0.1:11434/v1' }))
    expect(isDestinationApproved(local, [])).toBe(true)
  })

  it('approves a remote destination only once its identifier is stored', () => {
    const remote = describeDestination(provider({ kind: 'anthropic', base_url: null }))
    expect(isDestinationApproved(remote, [])).toBe(false)
    expect(isDestinationApproved(remote, ['anthropic'])).toBe(true)
  })
})

describe('labelForDestinationId', () => {
  it('reads back a friendly label from a stored identifier', () => {
    expect(labelForDestinationId('anthropic')).toBe('Claude')
    expect(labelForDestinationId('openai:mac-studio.example.ts.net')).toBe('mac-studio.example.ts.net')
  })
})
