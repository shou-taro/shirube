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
  testProfileConnection: vi.fn(),
  pickSqliteFile: vi.fn(),
}))

import { ConnectionForm } from '@/components/connection/connection-form'
import {
  createProfile,
  pickSqliteFile,
  testConnection,
  testProfileConnection,
  updateProfile,
} from '@/lib/api'

const mockCreate = vi.mocked(createProfile)
const mockUpdate = vi.mocked(updateProfile)
const mockTest = vi.mocked(testConnection)
const mockTestProfile = vi.mocked(testProfileConnection)
const mockPick = vi.mocked(pickSqliteFile)

const SAVED: Profile = {
  kind: 'postgresql',
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
  mockTestProfile.mockReset()
  mockPick.mockReset()
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
        kind: 'postgresql',
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

  it('verifies before saving and neither saves nor connects when the check fails', async () => {
    // A bad host must surface on the form, not enter the explorer. On create the check
    // runs first, so nothing is saved.
    mockTest.mockRejectedValue(new Error('Could not reach badhost:5432.'))
    const onConnected = vi.fn()
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={onConnected} onCancel={vi.fn()} />,
    )

    fillNewConnection()
    fireEvent.click(screen.getByRole('button', { name: /connection.saveAndConnect/ }))

    expect(await screen.findByText('Could not reach badhost:5432.')).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(onConnected).not.toHaveBeenCalled()
  })
})

describe('editing a profile', () => {
  const existing: Profile = {
    kind: 'postgresql',
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
    // Editing verifies the stored profile (password comes from the keychain).
    await waitFor(() => expect(mockTestProfile).toHaveBeenCalledWith('p1'))
  })

  it('does not connect when the saved profile fails verification', async () => {
    mockUpdate.mockResolvedValue(existing)
    mockTestProfile.mockRejectedValue(new Error('Authentication failed.'))
    const onConnected = vi.fn()
    render(
      <ConnectionForm
        initial={existing}
        editingId="p1"
        onConnected={onConnected}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /connection.saveAndConnect/ }))

    expect(await screen.findByText('Authentication failed.')).toBeInTheDocument()
    expect(onConnected).not.toHaveBeenCalled()
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

describe('SQLite profiles', () => {
  const SAVED_SQLITE: Profile = {
    kind: 'sqlite',
    id: 's1',
    name: 'chinook',
    path: '/data/chinook.sqlite',
    schemas: [],
  }

  function selectSqlite() {
    fireEvent.change(field(/connection.fields.kind/), { target: { value: 'sqlite' } })
  }

  it('swaps the server fields for a single file path', () => {
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={vi.fn()} onCancel={vi.fn()} />,
    )

    selectSqlite()

    expect(screen.getByLabelText(/connection.fields.path/)).toBeInTheDocument()
    // The PostgreSQL-only fields are gone.
    expect(screen.queryByLabelText(/connection.fields.host/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/connection.fields.password/)).not.toBeInTheDocument()
  })

  it('creates a SQLite profile from just a path, with no password', async () => {
    mockCreate.mockResolvedValue(SAVED_SQLITE)
    mockTest.mockResolvedValue(undefined)
    const onConnected = vi.fn()
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={onConnected} onCancel={vi.fn()} />,
    )

    selectSqlite()
    fireEvent.change(field(/connection.fields.name/), { target: { value: 'chinook' } })
    fireEvent.change(field(/connection.fields.path/), {
      target: { value: '/data/chinook.sqlite' },
    })
    fireEvent.click(screen.getByRole('button', { name: /connection.saveAndConnect/ }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        kind: 'sqlite',
        name: 'chinook',
        path: '/data/chinook.sqlite',
        schemas: [],
      }),
    )
    // The connection check is sent as a SQLite test, path only.
    expect(mockTest).toHaveBeenCalledWith({ kind: 'sqlite', path: '/data/chinook.sqlite' })
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(SAVED_SQLITE))
  })

  it('blocks testing with an empty path, naming the file field', async () => {
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={vi.fn()} onCancel={vi.fn()} />,
    )

    selectSqlite()
    fireEvent.click(screen.getByRole('button', { name: 'connection.test' }))

    // The mocked ``t`` echoes the key, so the field name shows through as ``…fields.path``.
    const message = await screen.findByText(/Enter the .* before testing\./)
    expect(message).toHaveTextContent('path')
    expect(mockTest).not.toHaveBeenCalled()
  })

  it('prefills the path when editing a SQLite profile', () => {
    render(
      <ConnectionForm
        initial={SAVED_SQLITE}
        editingId="s1"
        onConnected={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(field(/connection.fields.path/)).toHaveValue('/data/chinook.sqlite')
  })

  it('fills the path from the native file dialog', async () => {
    mockPick.mockResolvedValue('/data/picked.sqlite')
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={vi.fn()} onCancel={vi.fn()} />,
    )

    selectSqlite()
    fireEvent.click(screen.getByRole('button', { name: 'connection.browse' }))

    await waitFor(() =>
      expect(field(/connection.fields.path/)).toHaveValue('/data/picked.sqlite'),
    )
  })

  it('leaves the path unchanged when the dialog is cancelled', async () => {
    mockPick.mockResolvedValue(null)
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={vi.fn()} onCancel={vi.fn()} />,
    )

    selectSqlite()
    fireEvent.change(field(/connection.fields.path/), { target: { value: '/typed.sqlite' } })
    fireEvent.click(screen.getByRole('button', { name: 'connection.browse' }))

    await waitFor(() => expect(mockPick).toHaveBeenCalled())
    expect(field(/connection.fields.path/)).toHaveValue('/typed.sqlite')
  })

  it('shows the message and keeps the field when no dialog is available', async () => {
    mockPick.mockRejectedValue(new Error('A file dialog is not available here.'))
    render(
      <ConnectionForm initial={null} editingId={null} onConnected={vi.fn()} onCancel={vi.fn()} />,
    )

    selectSqlite()
    fireEvent.click(screen.getByRole('button', { name: 'connection.browse' }))

    expect(await screen.findByText('A file dialog is not available here.')).toBeInTheDocument()
  })
})
