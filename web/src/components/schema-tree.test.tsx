import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Column, ObjectKind, Relationship, SchemaObject } from '@/lib/api'

// t returns the key (with interpolation appended), so tests match on stable keys.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}))

import { SchemaTree } from '@/components/schema-tree'

function col(name: string, extra: Partial<Column> = {}): Column {
  return { name, data_type: 'int', nullable: true, is_primary_key: false, ...extra }
}

function object(
  id: string,
  { kind = 'table' as ObjectKind, columns = [] as Column[] } = {},
): SchemaObject {
  const [schema, name] = id.split('.')
  return { id, schema, name: name ?? id, kind, columns, partitions: [] }
}

function open(
  objects: SchemaObject[],
  {
    relationships = [] as Relationship[],
    activeId = null as string | null,
    onSelect = vi.fn(),
  } = {},
) {
  render(
    <SchemaTree
      objects={objects}
      relationships={relationships}
      activeId={activeId}
      onSelect={onSelect}
    />,
  )
  fireEvent.click(screen.getByLabelText('tree.open'))
  return { onSelect }
}

// The popover eases out with an exit animation, so it stays mounted for a short delay
// after a close before unmounting. Advance past that delay to let the unmount complete.
// Requires fake timers to be installed in the test.
function finishClosing(): void {
  act(() => vi.advanceTimersByTime(150))
}

describe('SchemaTree', () => {
  // The close tests install fake timers to drive the exit-animation delay; restore real
  // timers afterwards so the rest are unaffected.
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists objects grouped by schema once opened', () => {
    open([object('public.customer'), object('sales.orders')])

    expect(screen.getByText('public')).toBeInTheDocument()
    expect(screen.getByText('sales')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /customer/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /orders/ })).toBeInTheDocument()
  })

  it('travels to an object on click and leaves the popover open', () => {
    const { onSelect } = open([object('public.customer')])

    fireEvent.click(screen.getByRole('button', { name: /customer/ }))

    expect(onSelect).toHaveBeenCalledWith('public.customer')
    // The close button is only present while the popover is open.
    expect(screen.getByLabelText('tree.close')).toBeInTheDocument()
  })

  it('expands an object to show its columns and marks the primary key', () => {
    open([
      object('public.payment', {
        columns: [col('payment_id', { is_primary_key: true }), col('amount')],
      }),
    ])

    fireEvent.click(screen.getByLabelText('tree.expand'))

    expect(screen.getByText('payment_id')).toBeInTheDocument()
    expect(screen.getByText('amount')).toBeInTheDocument()
    expect(screen.getByLabelText('tree.primaryKey')).toBeInTheDocument()
  })

  it('marks a foreign-key column with its target', () => {
    open(
      [object('public.payment', { columns: [col('customer_id')] }), object('public.customer')],
      {
        relationships: [
          {
            constraint_name: 'payment_customer_fk',
            source: 'public.payment',
            source_columns: ['customer_id'],
            target: 'public.customer',
            target_columns: ['customer_id'],
            kind: 'foreign_key',
          },
        ],
      },
    )

    fireEvent.click(screen.getByLabelText('tree.expand'))

    // The interpolated target name rides along in the mocked translation.
    expect(screen.getByLabelText(/tree\.foreignKey.*customer/)).toBeInTheDocument()
  })

  it('highlights the map’s current centre', () => {
    open([object('public.customer'), object('public.film')], { activeId: 'public.customer' })

    expect(screen.getByRole('button', { name: /customer/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /film/ })).not.toHaveAttribute('aria-current')
  })

  it('collapses and re-expands a schema', () => {
    open([object('public.customer')])
    // The schema header carries its object count in its accessible name.
    const schemaHeader = screen.getByRole('button', { name: /public/ })
    expect(schemaHeader).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /customer/ })).toBeInTheDocument()

    fireEvent.click(schemaHeader)
    expect(schemaHeader).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /customer/ })).not.toBeInTheDocument()

    fireEvent.click(schemaHeader)
    expect(screen.getByRole('button', { name: /customer/ })).toBeInTheDocument()
  })

  it('collapses an expanded object again', () => {
    open([object('public.payment', { columns: [col('amount')] })])
    fireEvent.click(screen.getByLabelText('tree.expand'))
    expect(screen.getByText('amount')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('tree.collapse'))

    expect(screen.queryByText('amount')).not.toBeInTheDocument()
  })

  it('closes from the header close button', () => {
    vi.useFakeTimers()
    open([object('public.customer')])

    fireEvent.click(screen.getByLabelText('tree.close'))
    finishClosing()

    expect(screen.queryByLabelText('tree.close')).not.toBeInTheDocument()
    expect(screen.queryByText('public')).not.toBeInTheDocument()
  })

  it('closes on Escape', () => {
    vi.useFakeTimers()
    open([object('public.customer')])

    fireEvent.keyDown(document, { key: 'Escape' })
    finishClosing()

    expect(screen.queryByLabelText('tree.close')).not.toBeInTheDocument()
  })

  it('closes on an outside click', () => {
    vi.useFakeTimers()
    open([object('public.customer')])

    fireEvent.mouseDown(document.body)
    finishClosing()

    expect(screen.queryByLabelText('tree.close')).not.toBeInTheDocument()
  })

  it('stays mounted through its exit animation, then unmounts', () => {
    vi.useFakeTimers()
    open([object('public.customer')])

    fireEvent.click(screen.getByLabelText('tree.close'))

    // Still present while the exit animation runs — this is what makes the close animate
    // rather than vanish instantly.
    expect(screen.getByLabelText('tree.close')).toBeInTheDocument()

    // Only once the exit delay elapses does the popover leave the DOM.
    finishClosing()
    expect(screen.queryByLabelText('tree.close')).not.toBeInTheDocument()
  })
})
