import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CellValue, Column, RowPage, SchemaObject } from '@/lib/api'

// t returns the key, so tests can query by stable keys instead of translated copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Replace the network call; keep the real types and other exports.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchRows: vi.fn(),
}))

import { DataDrawer } from '@/components/data-drawer'
import { fetchRows } from '@/lib/api'

const mockFetchRows = vi.mocked(fetchRows)

function objectWith(columns: string[], id = 'public.users'): SchemaObject {
  return {
    id,
    schema: 'public',
    name: id.split('.')[1] ?? id,
    kind: 'table',
    columns: columns.map(
      (name): Column => ({ name, data_type: 'text', nullable: true, is_primary_key: false }),
    ),
  }
}

function pageWith(columns: string[], rows: CellValue[][], hasMore = false, offset = 0): RowPage {
  return { columns, rows, has_more: hasMore, offset, limit: 100 }
}

const DEFAULT_PAGE = pageWith(['id', 'email'], [[1, 'a@example.com'], [2, null]], true)

beforeEach(() => {
  mockFetchRows.mockReset()
  mockFetchRows.mockResolvedValue(DEFAULT_PAGE)
})

afterEach(() => {
  vi.mocked(fetchRows).mockReset()
})

function renderDrawer(object: SchemaObject = objectWith(['id', 'email'])) {
  return render(<DataDrawer profileId="p1" object={object} open onClose={vi.fn()} />)
}

describe('rendering rows', () => {
  it('shows a NULL cell distinctly from a real value', async () => {
    renderDrawer()

    expect(await screen.findByText('a@example.com')).toBeInTheDocument()
    // The null label is rendered (and is not the empty string).
    expect(screen.getByText('data.null')).toBeInTheDocument()
  })
})

describe('sorting', () => {
  it('cycles a column through ascending, descending and off', async () => {
    renderDrawer()
    await screen.findByText('a@example.com')

    const header = screen.getByRole('columnheader', { name: 'id' })

    fireEvent.click(header)
    await waitFor(() =>
      expect(mockFetchRows).toHaveBeenLastCalledWith(
        'p1',
        'public.users',
        expect.objectContaining({ sort: { column: 'id', direction: 'asc' } }),
      ),
    )

    fireEvent.click(header)
    await waitFor(() =>
      expect(mockFetchRows).toHaveBeenLastCalledWith(
        'p1',
        'public.users',
        expect.objectContaining({ sort: { column: 'id', direction: 'desc' } }),
      ),
    )

    fireEvent.click(header)
    await waitFor(() =>
      expect(mockFetchRows).toHaveBeenLastCalledWith(
        'p1',
        'public.users',
        expect.objectContaining({ sort: null }),
      ),
    )
  })
})

describe('paging', () => {
  it('disables previous on the first page and enables next when more rows exist', async () => {
    renderDrawer()
    await screen.findByText('a@example.com')

    expect(screen.getByRole('button', { name: 'data.previous' })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'data.next' })).toBeEnabled())
  })

  it('advances the offset by a page on next, and resets it to zero when sorting', async () => {
    renderDrawer()
    await screen.findByText('a@example.com')
    await waitFor(() => expect(screen.getByRole('button', { name: 'data.next' })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: 'data.next' }))
    await waitFor(() =>
      expect(mockFetchRows).toHaveBeenLastCalledWith(
        'p1',
        'public.users',
        expect.objectContaining({ offset: 100 }),
      ),
    )

    // Changing the sort returns to the first page.
    fireEvent.click(screen.getByRole('columnheader', { name: 'id' }))
    await waitFor(() =>
      expect(mockFetchRows).toHaveBeenLastCalledWith(
        'p1',
        'public.users',
        expect.objectContaining({ offset: 0, sort: { column: 'id', direction: 'asc' } }),
      ),
    )
  })
})

describe('filters', () => {
  it('adds, updates and removes a column filter', async () => {
    renderDrawer(objectWith(['id', 'email']))
    await screen.findByText('a@example.com')

    // Add: a filter on the first column, sent even before a value is typed.
    fireEvent.click(screen.getByRole('button', { name: /data.addFilter/ }))
    await waitFor(() =>
      expect(mockFetchRows).toHaveBeenLastCalledWith(
        'p1',
        'public.users',
        expect.objectContaining({
          filters: [{ column: 'id', operator: 'contains', value: '' }],
        }),
      ),
    )

    // Update: typing a value narrows the query.
    fireEvent.change(screen.getByPlaceholderText('data.filterValue'), {
      target: { value: 'acme' },
    })
    await waitFor(() =>
      expect(mockFetchRows).toHaveBeenLastCalledWith(
        'p1',
        'public.users',
        expect.objectContaining({
          filters: [{ column: 'id', operator: 'contains', value: 'acme' }],
        }),
      ),
    )

    // Remove: the query goes back to no filters.
    fireEvent.click(screen.getByRole('button', { name: 'data.removeFilter' }))
    await waitFor(() =>
      expect(mockFetchRows).toHaveBeenLastCalledWith(
        'p1',
        'public.users',
        expect.objectContaining({ filters: [] }),
      ),
    )
  })
})

describe('travelling to a new object', () => {
  it('resets sort and filters and re-reads for the new centre', async () => {
    const { rerender } = renderDrawer(objectWith(['id', 'email'], 'public.users'))
    await screen.findByText('a@example.com')

    // Add a filter on the first object.
    fireEvent.click(screen.getByRole('button', { name: /data.addFilter/ }))
    await waitFor(() => expect(screen.getByPlaceholderText('data.filterValue')).toBeInTheDocument())

    // Travel to a different object.
    mockFetchRows.mockResolvedValue(pageWith(['pk'], [[1]]))
    rerender(
      <DataDrawer
        profileId="p1"
        object={objectWith(['pk'], 'public.orders')}
        open
        onClose={vi.fn()}
      />,
    )

    // The filter chip is gone, and the fresh read has no sort or filters.
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('data.filterValue')).not.toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(mockFetchRows).toHaveBeenLastCalledWith(
        'p1',
        'public.orders',
        expect.objectContaining({ offset: 0, sort: null, filters: [] }),
      ),
    )
  })
})

describe('errors', () => {
  it('shows the failure message when the read fails', async () => {
    mockFetchRows.mockRejectedValue(new Error('Database unreachable.'))
    renderDrawer()

    expect(await screen.findByText('Database unreachable.')).toBeInTheDocument()
  })
})
