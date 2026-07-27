import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SchemaObject } from '@/lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}))

import { type ColumnRef, RelationshipTargetPicker } from '@/components/relationship-target-picker'

function column(name: string, isPk = false): SchemaObject['columns'][number] {
  return { name, data_type: 'integer', nullable: true, is_primary_key: isPk }
}

function object(id: string, columns: SchemaObject['columns']): SchemaObject {
  const [schema, name] = id.split('.')
  return { id, schema, name, kind: 'table', columns, partitions: [] }
}

const STORE = object('public.store', [column('store_id', true), column('name')])
const STAFF = object('public.staff', [column('staff_id', true)])
const SOURCE: ColumnRef = { schema: 'public', table: 'customer', column: 'store_id' }

function renderPicker(source: ColumnRef = SOURCE, objects: SchemaObject[] = [STORE, STAFF]) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(
    <RelationshipTargetPicker
      source={source}
      objects={objects}
      relationships={[]}
      onPick={onPick}
      onClose={onClose}
    />,
  )
  return { onPick, onClose }
}

describe('RelationshipTargetPicker', () => {
  it('shows the source column it is linking from', () => {
    renderPicker()

    expect(screen.getByText('customer.store_id')).toBeInTheDocument()
  })

  it('picks a target column on click', () => {
    const { onPick } = renderPicker()

    // Expand the store table, then pick its name column.
    fireEvent.click(screen.getByRole('button', { name: 'store' }))
    fireEvent.click(screen.getByRole('button', { name: /^name/ }))

    expect(onPick).toHaveBeenCalledWith({ schema: 'public', table: 'store', column: 'name' })
  })

  it('suggests the primary key of the table a `<name>_id` column points at', () => {
    const { onPick } = renderPicker()

    // `store_id` → suggest `store.store_id` up top.
    const suggestion = screen.getByRole('button', { name: /relationships\.suggested/ })
    expect(suggestion).toHaveTextContent('store.store_id')

    fireEvent.click(suggestion)
    expect(onPick).toHaveBeenCalledWith({ schema: 'public', table: 'store', column: 'store_id' })
  })

  it('filters tables and columns by name', () => {
    renderPicker()

    fireEvent.change(screen.getByLabelText('relationships.filter'), { target: { value: 'staff' } })

    expect(screen.getByRole('button', { name: 'staff' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'store' })).not.toBeInTheDocument()
  })

  it('has no suggestion for a column that is not `<name>_id`', () => {
    renderPicker({ schema: 'public', table: 'customer', column: 'note' })

    expect(screen.queryByRole('button', { name: /relationships\.suggested/ })).not.toBeInTheDocument()
  })

  it('closes on the close button', () => {
    const { onClose } = renderPicker()

    fireEvent.click(screen.getByLabelText('relationships.close'))

    expect(onClose).toHaveBeenCalled()
  })
})
