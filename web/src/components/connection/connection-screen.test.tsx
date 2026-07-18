import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Profile } from '@/lib/api'

// t returns the key; the profile-listing call is mocked.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listProfiles: vi.fn(),
  deleteProfile: vi.fn(),
}))

import { ConnectionScreen } from '@/components/connection/connection-screen'
import { listProfiles } from '@/lib/api'

const mockList = vi.mocked(listProfiles)

const PROFILE: Profile = {
  id: 'p1',
  name: 'shop',
  host: 'db',
  port: 5432,
  database: 'shop',
  username: 'ro',
  sslmode: 'prefer',
  schemas: [],
}

afterEach(() => {
  mockList.mockReset()
})

describe('ConnectionScreen', () => {
  it('opens straight into the form when there are no saved connections', async () => {
    mockList.mockResolvedValue([])

    render(<ConnectionScreen onConnected={vi.fn()} />)

    expect(await screen.findByText('connection.newConnection')).toBeInTheDocument()
  })

  it('shows the saved connections when some exist', async () => {
    mockList.mockResolvedValue([PROFILE])

    render(<ConnectionScreen onConnected={vi.fn()} />)

    expect(await screen.findByText('connection.savedConnections')).toBeInTheDocument()
    expect(screen.getByText('shop')).toBeInTheDocument()
  })

  it('connects when a saved connection is clicked', async () => {
    mockList.mockResolvedValue([PROFILE])
    const onConnected = vi.fn()

    render(<ConnectionScreen onConnected={onConnected} />)
    fireEvent.click(await screen.findByText('shop'))

    expect(onConnected).toHaveBeenCalledWith(PROFILE)
  })

  it('opens the form from the New button', async () => {
    mockList.mockResolvedValue([PROFILE])

    render(<ConnectionScreen onConnected={vi.fn()} />)
    await screen.findByText('connection.savedConnections')
    fireEvent.click(screen.getByRole('button', { name: 'connection.new' }))

    expect(await screen.findByText('connection.newConnection')).toBeInTheDocument()
  })
})
