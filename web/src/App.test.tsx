import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Profile } from '@/lib/api'

// t returns the key so assertions read against stable strings.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listProfiles: vi.fn(),
}))

// Stand in for the heavy children so this exercises App's own flow, not theirs. Each exposes
// the callback App passes it, as a button, so the connect/disconnect transitions can be driven.
vi.mock('@/components/explorer', () => ({
  Explorer: ({ profile, onDisconnect }: { profile: Profile; onDisconnect: () => void }) => (
    <div>
      <span>explorer:{profile.name}</span>
      <button type="button" onClick={onDisconnect}>
        disconnect
      </button>
    </div>
  ),
}))
vi.mock('@/components/connection/connection-screen', () => ({
  ConnectionScreen: ({ onConnected }: { onConnected: (profile: Profile) => void }) => (
    <button type="button" onClick={() => onConnected(profileFixture('p9', 'chosen'))}>
      connect
    </button>
  ),
}))

import { fireEvent } from '@testing-library/react'

import App from '@/App'
import { listProfiles } from '@/lib/api'
import { ACTIVE_PROFILE_KEY } from '@/lib/storage'

const mockList = vi.mocked(listProfiles)

function profileFixture(id: string, name: string): Profile {
  return {
    id,
    name,
    host: 'h',
    port: 5432,
    database: 'db',
    username: 'u',
    sslmode: 'require',
    schemas: [],
  }
}

beforeEach(() => {
  mockList.mockReset()
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('restoring the last connection', () => {
  it('shows the connection screen when nothing was stored', async () => {
    render(<App />)

    expect(await screen.findByText('connect')).toBeInTheDocument()
    // With no stored id, the profiles are never even fetched.
    expect(mockList).not.toHaveBeenCalled()
  })

  it('reconnects to a stored profile that still exists', async () => {
    localStorage.setItem(ACTIVE_PROFILE_KEY, 'p1')
    mockList.mockResolvedValue([profileFixture('p1', 'shop')])

    render(<App />)

    expect(await screen.findByText('explorer:shop')).toBeInTheDocument()
  })

  it('forgets a stored profile that is gone, and shows the connection screen', async () => {
    localStorage.setItem(ACTIVE_PROFILE_KEY, 'stale')
    mockList.mockResolvedValue([profileFixture('other', 'other')])

    render(<App />)

    expect(await screen.findByText('connect')).toBeInTheDocument()
    expect(localStorage.getItem(ACTIVE_PROFILE_KEY)).toBeNull()
  })

  it('stays on the connection screen if the lookup fails, keeping the stored id', async () => {
    localStorage.setItem(ACTIVE_PROFILE_KEY, 'p1')
    mockList.mockRejectedValue(new Error('offline'))

    render(<App />)

    expect(await screen.findByText('connect')).toBeInTheDocument()
    // A transient failure must not discard the remembered connection.
    expect(localStorage.getItem(ACTIVE_PROFILE_KEY)).toBe('p1')
  })
})

describe('connect and disconnect', () => {
  it('connects from the connection screen and remembers the profile', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('connect'))

    expect(await screen.findByText('explorer:chosen')).toBeInTheDocument()
    expect(localStorage.getItem(ACTIVE_PROFILE_KEY)).toBe('p9')
  })

  it('disconnects back to the connection screen and forgets the profile', async () => {
    localStorage.setItem(ACTIVE_PROFILE_KEY, 'p1')
    mockList.mockResolvedValue([profileFixture('p1', 'shop')])
    render(<App />)
    await screen.findByText('explorer:shop')

    fireEvent.click(screen.getByText('disconnect'))

    await waitFor(() => expect(screen.getByText('connect')).toBeInTheDocument())
    expect(localStorage.getItem(ACTIVE_PROFILE_KEY)).toBeNull()
  })
})
