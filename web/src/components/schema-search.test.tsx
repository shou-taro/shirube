import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Column, SchemaObject } from '@/lib/api'

// t returns the key, so tests query by stable keys rather than translated copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { SchemaSearch } from '@/components/schema-search'

function col(name: string): Column {
  return { name, data_type: 'text', nullable: true, is_primary_key: false }
}

function object(id: string, columns: Column[] = []): SchemaObject {
  return { id, schema: 'public', name: id.split('.')[1] ?? id, kind: 'table', columns }
}

// `identity` matches "id" by name; `orders` only by its customer_id column.
const IDENTITY = object('public.identity')
const ORDERS = object('public.orders', [col('customer_id')])

function renderSearch(objects: SchemaObject[], onSelect = vi.fn()) {
  render(<SchemaSearch objects={objects} onSelect={onSelect} />)
  const input = screen.getByRole('textbox')
  return { input, onSelect }
}

describe('matching', () => {
  it('ranks name matches above column matches', () => {
    const { input } = renderSearch([ORDERS, IDENTITY])

    fireEvent.change(input, { target: { value: 'id' } })

    const results = screen.getAllByRole('button')
    expect(results[0]).toHaveTextContent('identity')
    expect(results[1]).toHaveTextContent('orders')
  })

  it('shows a no-results message when nothing matches', () => {
    const { input } = renderSearch([IDENTITY, ORDERS])

    fireEvent.change(input, { target: { value: 'zzz' } })

    expect(screen.getByText('search.noResults')).toBeInTheDocument()
  })

  it('shows nothing until something is typed', () => {
    renderSearch([IDENTITY, ORDERS])

    // No query, no result list.
    expect(screen.queryByText('identity')).not.toBeInTheDocument()
  })
})

describe('selection', () => {
  it('selects a result on click and clears the query', () => {
    const { input, onSelect } = renderSearch([IDENTITY, ORDERS])

    fireEvent.change(input, { target: { value: 'identity' } })
    fireEvent.click(screen.getByRole('button', { name: /identity/ }))

    expect(onSelect).toHaveBeenCalledWith('public.identity')
    expect(input).toHaveValue('')
  })

  it('selects the highlighted result on Enter', () => {
    const { input, onSelect } = renderSearch([IDENTITY, ORDERS])

    fireEvent.change(input, { target: { value: 'orders' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('public.orders')
  })

  it('closes the results on Escape', () => {
    const { input } = renderSearch([IDENTITY, ORDERS])
    fireEvent.change(input, { target: { value: 'id' } })
    expect(screen.getByText('identity')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByText('identity')).not.toBeInTheDocument()
  })
})

describe('keyboard shortcut', () => {
  it('focuses the input on the platform chord (Ctrl+K off Apple)', () => {
    const { input } = renderSearch([IDENTITY])
    expect(input).not.toHaveFocus()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))

    expect(input).toHaveFocus()
  })
})
