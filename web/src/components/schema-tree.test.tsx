import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

describe('SchemaTree', () => {
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
    // The filter input is only present while the popover is open.
    expect(screen.getByLabelText('tree.filter')).toBeInTheDocument()
  })

  it('filters objects by name', () => {
    open([object('public.customer'), object('sales.orders')])

    fireEvent.change(screen.getByLabelText('tree.filter'), { target: { value: 'ord' } })

    expect(screen.getByRole('button', { name: /orders/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /customer/ })).not.toBeInTheDocument()
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
})
