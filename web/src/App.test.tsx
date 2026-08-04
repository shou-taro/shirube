import { act, render, screen, waitFor } from '@testing-library/react'
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

describe('dismissing the boot splash', () => {
  function addSplash(): HTMLElement {
    const splash = document.createElement('div')
    splash.id = 'splash'
    document.body.appendChild(splash)
    return splash
  }

  function setShownAt(when: number): void {
    ;(window as Window & { __splashShownAt?: number }).__splashShownAt = when
  }

  afterEach(() => {
    vi.useRealTimers()
    document.getElementById('splash')?.remove()
    delete (window as Window & { __splashShownAt?: number }).__splashShownAt
  })

  it('holds the splash for a minimum time, then fades it out and removes it', () => {
    vi.useFakeTimers()
    const splash = addSplash()
    // No paint timestamp recorded (the fallback path): the effect treats "now" as the
    // start, so the full minimum should elapse before it begins hiding.

    // No stored id → App is ready immediately, which triggers the dismissal.
    render(<App />)

    // Still fully up during the minimum hold.
    expect(splash.classList.contains('is-hidden')).toBe(false)
    expect(document.getElementById('splash')).not.toBeNull()

    // After the minimum it fades (gains the class) but is not yet removed.
    act(() => vi.advanceTimersByTime(3000))
    expect(splash.classList.contains('is-hidden')).toBe(true)
    expect(document.getElementById('splash')).not.toBeNull()

    // After the fade it is gone.
    act(() => vi.advanceTimersByTime(450))
    expect(document.getElementById('splash')).toBeNull()
  })

  it('hides promptly when the minimum has already passed by the time the app is ready', () => {
    vi.useFakeTimers()
    const splash = addSplash()
    // Painted well in the past (a slow start), so there is no minimum left to wait.
    setShownAt(Date.now() - 10_000)

    render(<App />)

    act(() => vi.advanceTimersByTime(0))
    expect(splash.classList.contains('is-hidden')).toBe(true)

    act(() => vi.advanceTimersByTime(450))
    expect(document.getElementById('splash')).toBeNull()
  })

  it('does nothing when there is no splash element', async () => {
    // The reconnect path keeps App restoring briefly; no splash node means the effect is a
    // no-op and the app still renders normally.
    render(<App />)

    expect(await screen.findByText('connect')).toBeInTheDocument()
  })
})
