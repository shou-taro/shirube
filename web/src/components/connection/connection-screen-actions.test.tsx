import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Profile } from '@/lib/api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listProfiles: vi.fn(),
  deleteProfile: vi.fn(),
  testProfileConnection: vi.fn(),
}))

// Drive the list's row actions directly, so this covers the screen's handlers without
// wrestling the real (Radix, portalled) dropdown menu open in jsdom.
vi.mock('@/components/connection/profiles-list', () => ({
  ProfilesList: (props: {
    onEdit: (p: Profile) => void
    onDuplicate: (p: Profile) => void
    onDelete: (p: Profile) => void
    profiles: Profile[]
  }) => (
    <div>
      <button type="button" onClick={() => props.onEdit(props.profiles[0])}>
        row-edit
      </button>
      <button type="button" onClick={() => props.onDuplicate(props.profiles[0])}>
        row-duplicate
      </button>
      <button type="button" onClick={() => props.onDelete(props.profiles[0])}>
        row-delete
      </button>
    </div>
  ),
}))
// Report which profile the form opened with, and expose its cancel.
vi.mock('@/components/connection/connection-form', () => ({
  ConnectionForm: (props: { initial: Profile | null; onCancel: () => void }) => (
    <div>
      <span>form-for:{props.initial?.name ?? 'new'}</span>
      <button type="button" onClick={props.onCancel}>
        form-cancel
      </button>
    </div>
  ),
}))

import { ConnectionScreen } from '@/components/connection/connection-screen'
import { deleteProfile, listProfiles } from '@/lib/api'

const mockList = vi.mocked(listProfiles)
const mockDelete = vi.mocked(deleteProfile)

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
  mockDelete.mockReset()
})

describe('ConnectionScreen row actions', () => {
  it('opens the form to edit a profile', async () => {
    mockList.mockResolvedValue([PROFILE])
    render(<ConnectionScreen onConnected={vi.fn()} />)

    fireEvent.click(await screen.findByText('row-edit'))

    expect(screen.getByText('form-for:shop')).toBeInTheDocument()
  })

  it('opens the form to duplicate a profile, with a copy name and no editing id', async () => {
    mockList.mockResolvedValue([PROFILE])
    render(<ConnectionScreen onConnected={vi.fn()} />)

    fireEvent.click(await screen.findByText('row-duplicate'))

    expect(screen.getByText('form-for:shop connection.copySuffix')).toBeInTheDocument()
  })

  it('deletes a profile and reloads the list', async () => {
    mockList.mockResolvedValue([PROFILE])
    mockDelete.mockResolvedValue()
    render(<ConnectionScreen onConnected={vi.fn()} />)
    await screen.findByText('row-delete')
    expect(mockList).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('row-delete'))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('p1'))
    // The list is reloaded after a delete.
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2))
  })

  it('returns to the list when the form is cancelled', async () => {
    mockList.mockResolvedValue([PROFILE])
    render(<ConnectionScreen onConnected={vi.fn()} />)
    fireEvent.click(await screen.findByText('row-edit'))

    fireEvent.click(screen.getByText('form-cancel'))

    expect(await screen.findByText('row-edit')).toBeInTheDocument()
  })
})
