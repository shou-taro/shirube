import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SchemaGraph, SchemaObject } from '@/lib/api'
import { makeFk, makeGraph, makeObject } from '@/test/factories'

// t returns the key, so tests query by stable keys rather than translated copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { TableDetail } from '@/components/table-detail'

const ORDERS: SchemaObject = {
  id: 'public.orders',
  schema: 'public',
  name: 'orders',
  kind: 'table',
  columns: [
    { name: 'id', data_type: 'integer', nullable: false, is_primary_key: true },
    { name: 'email', data_type: 'text', nullable: true, is_primary_key: false },
  ],
  partitions: [],
}

function renderDetail(graph: SchemaGraph, onNavigate = vi.fn()) {
  render(<TableDetail object={ORDERS} graph={graph} onNavigate={onNavigate} />)
  return { onNavigate }
}

describe('columns', () => {
  it('lists columns with their types and a NOT NULL marker on the non-nullable ones', () => {
    renderDetail(makeGraph([ORDERS]))

    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.getByText('email')).toBeInTheDocument()
    expect(screen.getByText('integer')).toBeInTheDocument()
    // Only `id` is NOT NULL.
    expect(screen.getAllByText('schema.notNull')).toHaveLength(1)
  })

  it('is open by default and collapses when its heading is clicked', () => {
    renderDetail(makeGraph([ORDERS]))

    const heading = screen.getByRole('button', { name: /schema.columns/ })
    expect(heading).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('email')).toBeInTheDocument()

    fireEvent.click(heading)

    expect(heading).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('email')).not.toBeInTheDocument()
  })
})

describe('relationships', () => {
  it('splits foreign keys into references and referenced-by', () => {
    // orders references users (outgoing); items references orders (incoming).
    const graph = makeGraph(
      [ORDERS, makeObject('public.users'), makeObject('public.items')],
      [makeFk('public.orders', 'public.users'), makeFk('public.items', 'public.orders')],
    )

    renderDetail(graph)

    // Both sections appear (each has one relationship); columns aside, they start collapsed.
    const references = screen.getByRole('button', { name: /schema.references/ })
    const referencedBy = screen.getByRole('button', { name: /schema.referencedBy/ })
    expect(references).toHaveAttribute('aria-expanded', 'false')
    expect(referencedBy).toHaveAttribute('aria-expanded', 'false')

    // Expanding references reveals the table it points at.
    fireEvent.click(references)
    expect(screen.getByRole('button', { name: /users/ })).toBeInTheDocument()

    // Expanding referenced-by reveals the table pointing at it.
    fireEvent.click(referencedBy)
    expect(screen.getByRole('button', { name: /items/ })).toBeInTheDocument()
  })

  it('travels to a related table when its row is clicked', () => {
    const graph = makeGraph(
      [ORDERS, makeObject('public.users')],
      [makeFk('public.orders', 'public.users')],
    )

    const { onNavigate } = renderDetail(graph)

    fireEvent.click(screen.getByRole('button', { name: /schema.references/ }))
    fireEvent.click(screen.getByRole('button', { name: /users/ }))

    expect(onNavigate).toHaveBeenCalledWith('public.users')
  })

  it('omits a relationships section that has no rows', () => {
    renderDetail(makeGraph([ORDERS]))

    expect(screen.queryByRole('button', { name: /schema.references/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /schema.referencedBy/ })).not.toBeInTheDocument()
  })

  it('badges a related view so it reads apart from a table', () => {
    const view = makeObject('public.order_totals', 0, 'view')
    const graph = makeGraph([ORDERS, view], [makeFk('public.orders', 'public.order_totals')])

    renderDetail(graph)
    fireEvent.click(screen.getByRole('button', { name: /schema.references/ }))

    // The related row carries the "view" badge (tables get none).
    expect(screen.getByText('schema.badgeView')).toBeInTheDocument()
  })
})

describe('partitions', () => {
  const payment = makeObject('public.payment', 1, 'partitioned_table', [
    { name: 'payment_p2022_01', bound: "FROM ('2022-01-01') TO ('2022-02-01')" },
    { name: 'payment_p2022_02', bound: "FROM ('2022-02-01') TO ('2022-03-01')" },
  ])

  it('lists a partitioned table’s children and their bounds under a collapsed section', () => {
    render(<TableDetail object={payment} graph={makeGraph([payment])} onNavigate={vi.fn()} />)

    const heading = screen.getByRole('button', { name: /schema.partitions/ })
    // Starts collapsed, like the relationship sections.
    expect(heading).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('payment_p2022_01')).not.toBeInTheDocument()

    fireEvent.click(heading)

    expect(screen.getByText('payment_p2022_01')).toBeInTheDocument()
    expect(screen.getByText("FROM ('2022-01-01') TO ('2022-02-01')")).toBeInTheDocument()
    expect(screen.getByText('payment_p2022_02')).toBeInTheDocument()
  })

  it('shows no partitions section for a plain table', () => {
    renderDetail(makeGraph([ORDERS]))

    expect(screen.queryByRole('button', { name: /schema.partitions/ })).not.toBeInTheDocument()
  })
})
