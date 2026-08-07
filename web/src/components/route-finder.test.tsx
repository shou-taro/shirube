import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Relationship, SchemaGraph, SchemaObject } from '@/lib/api'

// t returns the key (with interpolation appended), so assertions match on stable keys.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}))

import { RouteFinder } from '@/components/route-finder'

function object(id: string): SchemaObject {
  const [schema, name] = id.split('.')
  return { id, schema, name: name ?? id, kind: 'table', columns: [], partitions: [] }
}

function edge(source: string, target: string): Relationship {
  return {
    constraint_name: `${source}->${target}`,
    source,
    source_columns: [],
    target,
    target_columns: [],
    kind: 'foreign_key',
  }
}

// customer–address–city is a chain; customer_note hangs off nothing, so it is unreachable.
const OBJECTS = ['public.customer', 'public.customer_note', 'public.address', 'public.city'].map(
  object,
)
const GRAPH: SchemaGraph = {
  objects: OBJECTS,
  relationships: [edge('public.customer', 'public.address'), edge('public.address', 'public.city')],
}

function renderFinder(
  overrides: { activeId?: string | null; onNavigate?: () => void; onClose?: () => void } = {},
) {
  const onNavigate = overrides.onNavigate ?? vi.fn()
  const onClose = overrides.onClose ?? vi.fn()
  render(
    <RouteFinder
      initialSource={object('public.customer')}
      objects={OBJECTS}
      graph={GRAPH}
      activeId={overrides.activeId ?? null}
      onNavigate={onNavigate}
      onClose={onClose}
    />,
  )
  return { onNavigate, onClose }
}

const fromField = (): HTMLElement => screen.getByRole('combobox', { name: 'route.from' })
const toField = (): HTMLElement => screen.getByRole('combobox', { name: 'route.to' })

function type(field: HTMLElement, text: string): void {
  fireEvent.change(field, { target: { value: text } })
}

/** Type into a field and click the offered option for `name`. */
function pick(field: HTMLElement, text: string, optionName: RegExp): void {
  type(field, text)
  fireEvent.click(screen.getByRole('option', { name: optionName }))
}

describe('RouteFinder', () => {
  it('starts with the source it was opened from, pre-filled and changeable', () => {
    renderFinder()
    expect(fromField()).toHaveValue('customer')
    expect(screen.getByText('route.hint')).toBeInTheDocument()
  })

  it('offers destinations but never the source itself', () => {
    renderFinder()
    type(toField(), 'customer')

    // "customer" matches both the source and "customer_note"; only the latter is offered,
    // so exactly one option shows — the source is never a destination for itself.
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('customer_note')
  })

  it('draws the hop list once a reachable destination is chosen', () => {
    renderFinder()
    pick(toField(), 'city', /city/)

    // The route is customer → address → city, shown as three numbered steps in order.
    const steps = screen.getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    expect(within(steps[0]).getByText('customer')).toBeInTheDocument()
    expect(within(steps[1]).getByText('address')).toBeInTheDocument()
    expect(within(steps[2]).getByText('city')).toBeInTheDocument()
  })

  it('recomputes the route when the source is changed', () => {
    renderFinder()
    pick(toField(), 'city', /city/)
    // Re-point the start from customer to address; the route shortens to address → city.
    pick(fromField(), 'address', /address/)

    const steps = screen.getAllByRole('listitem')
    expect(steps).toHaveLength(2)
    expect(within(steps[0]).getByText('address')).toBeInTheDocument()
    expect(within(steps[1]).getByText('city')).toBeInTheDocument()
  })

  it('does not offer the chosen destination as a source', () => {
    renderFinder()
    pick(toField(), 'city', /city/)
    // With city as the destination, it must not appear when searching for a source.
    type(fromField(), 'city')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('moves the active option with the arrow keys and picks it with Enter', () => {
    const { onNavigate } = renderFinder()
    // "c" matches two destinations in order: customer_note, then city (customer is the
    // source, so it is excluded).
    type(toField(), 'c')
    const [first, second] = screen.getAllByRole('option')
    expect(first).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(toField(), { key: 'ArrowDown' })
    expect(second).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(toField(), { key: 'ArrowUp' })
    expect(first).toHaveAttribute('aria-selected', 'true')

    // Land on the second (city) and commit it with Enter.
    fireEvent.keyDown(toField(), { key: 'ArrowDown' })
    fireEvent.keyDown(toField(), { key: 'Enter' })

    fireEvent.click(screen.getByRole('button', { name: /city/ }))
    expect(onNavigate).toHaveBeenCalledWith('public.city')
  })

  it('highlights the option under the pointer', () => {
    renderFinder()
    type(toField(), 'c')
    const options = screen.getAllByRole('option')

    fireEvent.mouseEnter(options[1])
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('shuts the results on the first Escape, then closes the finder on the next', () => {
    const { onClose } = renderFinder()
    type(toField(), 'city')
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    // First Escape: only the results close; the finder stays open.
    fireEvent.keyDown(toField(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    // Second Escape, with the results already shut, dismisses the finder.
    fireEvent.keyDown(toField(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores arrow keys when nothing matches', () => {
    renderFinder()
    type(toField(), 'zzz-nothing')
    // No results to move through; the key press is a no-op rather than an error.
    expect(() => fireEvent.keyDown(toField(), { key: 'ArrowDown' })).not.toThrow()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('travels the map to a hop when its step is clicked, staying open', () => {
    const { onNavigate, onClose } = renderFinder()
    pick(toField(), 'city', /city/)

    fireEvent.click(screen.getByRole('button', { name: /address/ }))

    expect(onNavigate).toHaveBeenCalledWith('public.address')
    // Walking a hop must not dismiss the finder.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('marks the hop the map is currently centred on', () => {
    renderFinder({ activeId: 'public.address' })
    pick(toField(), 'city', /city/)

    expect(screen.getByRole('button', { name: /address/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /city/ })).not.toHaveAttribute('aria-current')
  })

  it('says so when there is no route between the two tables', () => {
    renderFinder()
    pick(toField(), 'customer_note', /customer_note/)

    expect(screen.getByText('route.noRoute')).toBeInTheDocument()
  })

  it('drops an unconfirmed edit on blur, restoring the committed selection', () => {
    vi.useFakeTimers()
    try {
      renderFinder()
      // Type over the pre-filled source without picking anything, then leave the field.
      type(fromField(), 'zzz')
      expect(fromField()).toHaveValue('zzz')

      fireEvent.blur(fromField())
      act(() => vi.advanceTimersByTime(120))

      // The field reverts to the source it still holds, not the abandoned text.
      expect(fromField()).toHaveValue('customer')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the results open when the pointer goes down on them', () => {
    renderFinder()
    type(toField(), 'city')
    const list = screen.getByRole('listbox')

    // A blur schedules the results to close; pressing on the list cancels that, so a click
    // on an option still lands.
    fireEvent.blur(toField())
    fireEvent.mouseDown(list)

    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('closes from the header button and on Escape', () => {
    const { onClose } = renderFinder()

    fireEvent.click(screen.getByLabelText('route.close'))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
