import { fireEvent, render, screen, within } from '@testing-library/react'
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

function renderFinder(overrides: { activeId?: string | null; onNavigate?: () => void; onClose?: () => void } = {}) {
  const onNavigate = overrides.onNavigate ?? vi.fn()
  const onClose = overrides.onClose ?? vi.fn()
  render(
    <RouteFinder
      source={object('public.customer')}
      objects={OBJECTS}
      graph={GRAPH}
      activeId={overrides.activeId ?? null}
      onNavigate={onNavigate}
      onClose={onClose}
    />,
  )
  return { onNavigate, onClose }
}

function typeDestination(text: string): void {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: text } })
}

describe('RouteFinder', () => {
  it('shows the fixed source table it routes from', () => {
    renderFinder()
    // Before a destination is chosen, the source name shows once (in the From chip).
    expect(screen.getByText('customer')).toBeInTheDocument()
    expect(screen.getByText('route.hint')).toBeInTheDocument()
  })

  it('offers destinations but never the source itself', () => {
    renderFinder()
    typeDestination('customer')

    // "customer" matches both the source and "customer_note"; only the latter is offered,
    // so exactly one option shows — the source is never a destination for itself.
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('customer_note')
  })

  it('draws the hop list once a reachable destination is chosen', () => {
    renderFinder()
    typeDestination('city')
    fireEvent.click(screen.getByRole('option', { name: /city/ }))

    // The route is customer → address → city, shown as three numbered steps in order.
    const steps = screen.getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    expect(within(steps[0]).getByText('customer')).toBeInTheDocument()
    expect(within(steps[1]).getByText('address')).toBeInTheDocument()
    expect(within(steps[2]).getByText('city')).toBeInTheDocument()
  })

  it('travels the map to a hop when its step is clicked, staying open', () => {
    const { onNavigate, onClose } = renderFinder()
    typeDestination('city')
    fireEvent.click(screen.getByRole('option', { name: /city/ }))

    fireEvent.click(screen.getByRole('button', { name: /address/ }))

    expect(onNavigate).toHaveBeenCalledWith('public.address')
    // Walking a hop must not dismiss the finder.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('marks the hop the map is currently centred on', () => {
    renderFinder({ activeId: 'public.address' })
    typeDestination('city')
    fireEvent.click(screen.getByRole('option', { name: /city/ }))

    expect(screen.getByRole('button', { name: /address/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /city/ })).not.toHaveAttribute('aria-current')
  })

  it('says so when there is no route between the two tables', () => {
    renderFinder()
    typeDestination('customer_note')
    fireEvent.click(screen.getByRole('option', { name: /customer_note/ }))

    expect(screen.getByText('route.noRoute')).toBeInTheDocument()
  })

  it('closes from the header button and on Escape', () => {
    const { onClose } = renderFinder()

    fireEvent.click(screen.getByLabelText('route.close'))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
