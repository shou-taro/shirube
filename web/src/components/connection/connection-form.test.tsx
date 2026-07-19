import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Profile } from '@/lib/api'

// t returns the key, so tests query by stable keys rather than translated copy. The
// one exception mirrors the real copy for the "missing fields" message, so a test can
// assert which fields it actually names.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { fields?: string }) =>
      key === 'connection.testMissingFields' && opts?.fields
        ? `Enter the ${opts.fields} before testing.`
        : key,
  }),
}))

// Replace the network calls; keep the real types and other exports.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  testConnection: vi.fn(),
}))

import { ConnectionForm } from '@/components/connection/connection-form'
import { createProfile, testConnection, updateProfile } from '@/lib/api'

const mockCreate = vi.mocked(createProfile)
const mockUpdate = vi.mocked(updateProfile)
const mockTest = vi.mocked(testConnection)

const SAVED: Profile = {
  id: 'new',
  name: 'shop',
  host: 'db',
  port: 5433,
  database: 'shop',
  username: 'ro',
  sslmode: 'prefer',
  schemas: ['public', 'sales'],
}

afterEach(() => {
  mockCreate.mockReset()
  mockUpdate.mockReset()
  mockTest.mockReset()
})

function field(label: RegExp) {
  return screen.getByLabelText(label)
}

function fillNewConnection() {
  fireEvent.change(field(/connection.fields.name/), { target: { value: 'shop' } })
  fireEvent.change(field(/connection.fields.host/), { target: { value: 'db' } })
  fireEvent.change(field(/connection.fields.port/), { target: { value: '5433' } })
  fireEvent.change(field(/connection.fields.database/), { target: { value: 'shop' } })
  fireEvent.change(field(/connection.fields.username/), { target: { value: 'ro' } })
  fireEvent.change(field(/connection.fields.password/), { target: { value: 'secret' } })
  fireEvent.change(field(/connection.fields.schemas/), { target: { value: 'public, sales' } })
}

describe('creating a profile', () => {
  it('coerces the port, splits the schemas, and connects on save', async () => {
    mockCreate.mockResolvedValue(SAVED)
    const onConnected = vi.fn()
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={onConnected} onCancel={vi.fn()} />,
    )

    fillNewConnection()
    fireEvent.click(screen.getByRole('button', { name: /connection.saveAndConnect/ }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'shop',
        host: 'db',
        port: 5433,
        database: 'shop',
        username: 'ro',
        password: 'secret',
        sslmode: 'prefer',
        schemas: ['public', 'sales'],
      }),
    )
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(SAVED))
  })

  it('shows the backend error and does not connect when saving fails', async () => {
    mockCreate.mockRejectedValue(new Error('Database does not exist.'))
    const onConnected = vi.fn()
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={onConnected} onCancel={vi.fn()} />,
    )

    fillNewConnection()
    fireEvent.click(screen.getByRole('button', { name: /connection.saveAndConnect/ }))

    expect(await screen.findByText('Database does not exist.')).toBeInTheDocument()
    expect(onConnected).not.toHaveBeenCalled()
  })
})

describe('editing a profile', () => {
  const existing: Profile = {
    id: 'p1',
    name: 'shop',
    host: 'db',
    port: 5432,
    database: 'shop',
    username: 'ro',
    sslmode: 'require',
    schemas: ['public'],
  }

  it('updates the existing profile and omits the password when left blank', async () => {
    mockUpdate.mockResolvedValue(existing)
    render(
      <ConnectionForm
        initial={existing}
        editingId="p1"
        onConnected={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /connection.saveAndConnect/ }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ name: 'shop', schemas: ['public'], password: undefined }),
      ),
    )
  })
})

describe('testing the connection', () => {
  it('reports success', async () => {
    mockTest.mockResolvedValue(undefined)
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={vi.fn()} onCancel={vi.fn()} />,
    )

    fillNewConnection()
    fireEvent.click(screen.getByRole('button', { name: 'connection.test' }))

    expect(await screen.findByText('connection.testOk')).toBeInTheDocument()
    expect(mockTest).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'db', port: 5433, password: 'secret' }),
    )
  })

  it('reports a failure inline', async () => {
    mockTest.mockRejectedValue(new Error('Authentication failed.'))
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={vi.fn()} onCancel={vi.fn()} />,
    )

    fillNewConnection()
    fireEvent.click(screen.getByRole('button', { name: 'connection.test' }))

    expect(await screen.findByText('Authentication failed.')).toBeInTheDocument()
  })

  it('blocks testing with an empty host, naming only the host, and never calls the backend', async () => {
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={vi.fn()} onCancel={vi.fn()} />,
    )

    // Everything but the host — the Test button bypasses the form's required checks.
    fireEvent.change(field(/connection.fields.database/), { target: { value: 'shop' } })
    fireEvent.change(field(/connection.fields.username/), { target: { value: 'ro' } })
    fireEvent.click(screen.getByRole('button', { name: 'connection.test' }))

    // Only the blank field is named — not the ones the user already filled.
    const message = await screen.findByText(/Enter the .* before testing\./)
    expect(message).toHaveTextContent('host')
    expect(message).not.toHaveTextContent('database')
    expect(message).not.toHaveTextContent('user')
    expect(mockTest).not.toHaveBeenCalled()
  })
})

describe('validation', () => {
  it('requires the password when creating but not when editing', () => {
    const { rerender } = render(
      <ConnectionForm initial={null} editingId={null} onConnected={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(field(/connection.fields.password/)).toBeRequired()

    rerender(
      <ConnectionForm
        initial={SAVED}
        editingId="p1"
        onConnected={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(field(/connection.fields.password/)).not.toBeRequired()
  })

  it('marks the core credential fields required', () => {
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={vi.fn()} onCancel={vi.fn()} />,
    )

    expect(field(/connection.fields.name/)).toBeRequired()
    expect(field(/connection.fields.host/)).toBeRequired()
    expect(field(/connection.fields.database/)).toBeRequired()
    expect(field(/connection.fields.username/)).toBeRequired()
  })
})
