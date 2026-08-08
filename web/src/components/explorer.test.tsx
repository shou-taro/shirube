import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiProvider, Profile, SchemaGraph } from '@/lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchSchema: vi.fn(),
  fetchAiProvider: vi.fn(),
  addManualRelationship: vi.fn(),
  deleteManualRelationship: vi.fn(),
}))

// Capture what the container hands its heavy children, so its own logic can be asserted
// without rendering React Flow or the real panes.
const erProps = vi.fn()
vi.mock('@/components/er/er-diagram', () => ({
  ErDiagram: (props: { graph: SchemaGraph; onCentreChange: (id: string) => void }) => {
    erProps(props)
    return (
      <button type="button" onClick={() => props.onCentreChange('public.orders')}>
        centre-orders
      </button>
    )
  },
}))

const navProps = vi.fn()
vi.mock('@/components/navigator-pane', () => ({
  NavigatorPane: (props: {
    provider: AiProvider | null
    onApprove: (id: string) => void
    onOpenSettings: () => void
    onNavigate: (id: string) => void
  }) => {
    navProps(props)
    return (
      <div>
        <button type="button" onClick={() => props.onApprove('anthropic')}>
          nav-approve
        </button>
        <button type="button" onClick={props.onOpenSettings}>
          nav-open-settings
        </button>
        <button type="button" onClick={() => props.onNavigate('public.orders')}>
          nav-navigate
        </button>
      </div>
    )
  },
}))

const settingsProps = vi.fn()
vi.mock('@/components/settings-dialog', () => ({
  SettingsDialog: (props: {
    open: boolean
    initialCategory?: string
    onClose: () => void
    onRevoke: (id: string) => void
  }) => {
    settingsProps(props)
    return props.open ? (
      <div>
        <span>settings:{props.initialCategory}</span>
        <button type="button" onClick={props.onClose}>
          settings-close
        </button>
        <button type="button" onClick={() => props.onRevoke('anthropic')}>
          settings-revoke
        </button>
      </div>
    ) : null
  },
}))

vi.mock('@/components/data-drawer', () => ({ DataDrawer: () => <div>data-drawer</div> }))

// Surface the detail card's manual-relationship callbacks as plain buttons, so the
// container's link-drawing logic can be driven without the real card.
vi.mock('@/components/table-detail', () => ({
  TableDetail: (props: {
    onStartLink: (column: string) => void
    onRemoveRelationship: (id: string) => void
  }) => (
    <div>
      table-detail
      <button type="button" onClick={() => props.onStartLink('customer_id')}>
        detail-start-link
      </button>
      <button type="button" onClick={() => props.onRemoveRelationship('rel-1')}>
        detail-remove-rel
      </button>
    </div>
  ),
}))

// The target picker only mounts once a source column is chosen; expose its pick and close
// so the create flow can complete without the real column tree.
const pickerProps = vi.fn()
vi.mock('@/components/relationship-target-picker', () => ({
  RelationshipTargetPicker: (props: {
    busy: boolean
    onPick: (target: { schema: string; table: string; column: string }) => void
    onClose: () => void
  }) => {
    pickerProps(props)
    return (
      <div>
        relationship-target-picker
        <button
          type="button"
          onClick={() => props.onPick({ schema: 'public', table: 'active', column: 'id' })}
        >
          picker-pick
        </button>
        <button type="button" onClick={props.onClose}>
          picker-close
        </button>
      </div>
    )
  },
}))
vi.mock('@/components/schema-search', () => ({
  SchemaSearch: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('public.orders')}>
      search-orders
    </button>
  ),
}))
vi.mock('@/components/ui/resize-handle', () => ({ ResizeHandle: () => <div>resize-handle</div> }))

import { Explorer } from '@/components/explorer'
import {
  addManualRelationship,
  deleteManualRelationship,
  fetchAiProvider,
  fetchSchema,
} from '@/lib/api'
import { SettingsProvider } from '@/components/settings-provider'
import { SETTINGS_KEY } from '@/lib/storage'

const mockSchema = vi.mocked(fetchSchema)
const mockProvider = vi.mocked(fetchAiProvider)
const mockAddManual = vi.mocked(addManualRelationship)
const mockDeleteManual = vi.mocked(deleteManualRelationship)

const PROFILE: Profile = {
  id: 'p1',
  name: 'shop',
  host: 'h',
  port: 5432,
  database: 'shopdb',
  username: 'u',
  sslmode: 'require',
  schemas: [],
}

const GRAPH: SchemaGraph = {
  objects: [
    { id: 'public.orders', schema: 'public', name: 'orders', kind: 'table', columns: [] },
    { id: 'public.active', schema: 'public', name: 'active', kind: 'view', columns: [] },
  ],
  relationships: [
    {
      constraint_name: 'fk',
      source: 'public.orders',
      source_columns: ['id'],
      target: 'public.active',
      target_columns: ['id'],
      kind: 'foreign_key',
    },
    {
      constraint_name: 'dep',
      source: 'public.active',
      source_columns: [],
      target: 'public.orders',
      target_columns: [],
      kind: 'view_dependency',
    },
  ],
}

function renderExplorer() {
  const onDisconnect = vi.fn()
  render(
    <SettingsProvider>
      <Explorer profile={PROFILE} onDisconnect={onDisconnect} />
    </SettingsProvider>,
  )
  return { onDisconnect }
}

beforeEach(() => {
  mockSchema.mockReset()
  mockProvider.mockReset()
  mockProvider.mockResolvedValue(null)
  mockAddManual.mockReset()
  mockDeleteManual.mockReset()
  erProps.mockClear()
  navProps.mockClear()
  settingsProps.mockClear()
  pickerProps.mockClear()
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('schema loading states', () => {
  it('shows a spinner while the schema loads', () => {
    mockSchema.mockReturnValue(new Promise(() => {}))
    renderExplorer()

    expect(screen.getByText('schema.loading')).toBeInTheDocument()
  })

  it('shows the error and retries on demand', async () => {
    mockSchema.mockRejectedValueOnce(new Error('boom'))
    renderExplorer()

    expect(await screen.findByText('boom')).toBeInTheDocument()

    mockSchema.mockResolvedValueOnce(GRAPH)
    fireEvent.click(screen.getByText('schema.retry'))

    expect(await screen.findByText('centre-orders')).toBeInTheDocument()
  })

  it('shows the empty message when the database has no objects', async () => {
    mockSchema.mockResolvedValue({ objects: [], relationships: [] })
    renderExplorer()

    expect(await screen.findByText('schema.empty')).toBeInTheDocument()
  })

  it('draws the diagram when the schema is ready', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    renderExplorer()

    expect(await screen.findByText('centre-orders')).toBeInTheDocument()
    expect(erProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ graph: expect.objectContaining({ objects: GRAPH.objects }) }),
    )
  })
})

describe('view-dependency filtering', () => {
  it('keeps view-dependency edges by default', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    renderExplorer()
    await screen.findByText('centre-orders')

    const graph = erProps.mock.lastCall?.[0].graph as SchemaGraph
    expect(graph.relationships).toHaveLength(2)
  })

  it('drops view-dependency edges when the setting is off', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showViewDependencies: false }))
    mockSchema.mockResolvedValue(GRAPH)
    renderExplorer()
    await screen.findByText('centre-orders')

    const graph = erProps.mock.lastCall?.[0].graph as SchemaGraph
    expect(graph.relationships).toHaveLength(1)
    expect(graph.relationships[0].kind).toBe('foreign_key')
  })
})

describe('provider and approvals', () => {
  it('loads the provider and passes it to the navigator', async () => {
    const provider: AiProvider = {
      kind: 'anthropic',
      model: 'claude-opus-4-8',
      base_url: null,
      has_api_key: true,
    }
    mockSchema.mockResolvedValue(GRAPH)
    mockProvider.mockResolvedValue(provider)
    renderExplorer()

    await waitFor(() =>
      expect(navProps).toHaveBeenLastCalledWith(expect.objectContaining({ provider })),
    )
  })

  it('reloads the provider when settings close', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    renderExplorer()
    await screen.findByText('centre-orders')
    expect(mockProvider).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('nav-open-settings'))
    fireEvent.click(screen.getByText('settings-close'))

    await waitFor(() => expect(mockProvider).toHaveBeenCalledTimes(2))
  })

  it('opens settings on the AI group from the navigator', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    renderExplorer()
    await screen.findByText('centre-orders')

    fireEvent.click(screen.getByText('nav-open-settings'))

    expect(screen.getByText('settings:ai')).toBeInTheDocument()
  })

  it('opens settings on Appearance from the top-bar gear', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    renderExplorer()
    await screen.findByText('centre-orders')

    fireEvent.click(screen.getByLabelText('settings.title'))

    expect(screen.getByText('settings:appearance')).toBeInTheDocument()
  })

  it('threads approve and revoke through to the same approved list', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    renderExplorer()
    await screen.findByText('centre-orders')

    fireEvent.click(screen.getByText('nav-approve'))
    await waitFor(() =>
      expect(navProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ approved: ['anthropic'] }),
      ),
    )

    fireEvent.click(screen.getByText('nav-open-settings'))
    fireEvent.click(screen.getByText('settings-revoke'))
    await waitFor(() =>
      expect(settingsProps).toHaveBeenLastCalledWith(expect.objectContaining({ approved: [] })),
    )
  })
})

describe('navigation and layout', () => {
  it('clears the search override once the map arrives at it', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    renderExplorer()
    await screen.findByText('centre-orders')

    // Search sets the override; the diagram is told to travel to it.
    fireEvent.click(screen.getByText('search-orders'))
    await waitFor(() =>
      expect(erProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ centreOverride: 'public.orders' }),
      ),
    )

    // The map reports it has arrived; the override is released so a repeat can retravel.
    fireEvent.click(screen.getByText('centre-orders'))
    await waitFor(() =>
      expect(erProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ centreOverride: null }),
      ),
    )
  })

  it('collapses the navigator pane to zero width when toggled off', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    renderExplorer()
    await screen.findByText('centre-orders')

    fireEvent.click(screen.getByTitle('panes.collapse'))

    // The pane's wrapper is the element sized by the toggle.
    const pane = screen.getByText('nav-open-settings').closest('[style*="width"]')
    expect(pane).toHaveStyle({ width: '0px' })
  })

  it('toggles the row-preview drawer from the detail card', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    renderExplorer()
    await screen.findByText('centre-orders')
    // Centre a table so the detail card — and its data-view footer — appears.
    fireEvent.click(screen.getByText('centre-orders'))

    const toggle = await screen.findByText('data.view')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens the route finder from the detail card, started at the current table', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    renderExplorer()
    await screen.findByText('centre-orders')
    // Centre a table so the detail card — and its footer's "find a route" action — appears.
    fireEvent.click(screen.getByText('centre-orders'))

    fireEvent.click(await screen.findByText('route.findShort'))

    // The finder mounts, its source seeded from the current centre.
    expect(screen.getByText('route.title')).toBeInTheDocument()
    expect(screen.getByDisplayValue('orders')).toBeInTheDocument()

    // And it closes again from its own control.
    fireEvent.click(screen.getByLabelText('route.close'))
    expect(screen.queryByText('route.title')).not.toBeInTheDocument()
  })

  it('treats a provider load failure as no provider', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    mockProvider.mockRejectedValueOnce(new Error('unreachable'))
    renderExplorer()
    await screen.findByText('centre-orders')

    await waitFor(() =>
      expect(navProps).toHaveBeenLastCalledWith(expect.objectContaining({ provider: null })),
    )
  })
})

// Centre a table and open the target picker for a source column, so a create flow can run.
async function startDrawing() {
  await screen.findByText('centre-orders')
  fireEvent.click(screen.getByText('centre-orders'))
  fireEvent.click(await screen.findByText('detail-start-link'))
  await screen.findByText('relationship-target-picker')
}

describe('manual relationships', () => {
  it('draws a link, then offers undo on the notice', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    mockAddManual.mockResolvedValue({
      id: 'm1',
      source_schema: 'public',
      source_table: 'orders',
      source_column: 'customer_id',
      target_schema: 'public',
      target_table: 'active',
      target_column: 'id',
    })
    renderExplorer()
    await startDrawing()

    fireEvent.click(screen.getByText('picker-pick'))

    expect(await screen.findByText('relationships.added')).toBeInTheDocument()
    expect(mockAddManual).toHaveBeenCalledWith('p1', {
      source_schema: 'public',
      source_table: 'orders',
      source_column: 'customer_id',
      target_schema: 'public',
      target_table: 'active',
      target_column: 'id',
    })
    // A successful draw refreshes the schema in place (a second fetch beyond the first load).
    await waitFor(() => expect(mockSchema).toHaveBeenCalledTimes(2))
    // The picker closes once the source is consumed.
    expect(screen.queryByText('relationship-target-picker')).not.toBeInTheDocument()
    expect(screen.getByText('relationships.undo')).toBeInTheDocument()
  })

  it('surfaces an error when drawing a link fails', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    mockAddManual.mockRejectedValueOnce(new Error('duplicate link'))
    renderExplorer()
    await startDrawing()

    fireEvent.click(screen.getByText('picker-pick'))

    expect(await screen.findByText('duplicate link')).toBeInTheDocument()
  })

  it('surfaces a refresh failure after a link is drawn', async () => {
    mockSchema.mockResolvedValueOnce(GRAPH) // first load succeeds
    mockAddManual.mockResolvedValue({
      id: 'm1',
      source_schema: 'public',
      source_table: 'orders',
      source_column: 'customer_id',
      target_schema: 'public',
      target_table: 'active',
      target_column: 'id',
    })
    mockSchema.mockRejectedValueOnce(new Error('refresh failed')) // the in-place refresh fails
    renderExplorer()
    await startDrawing()

    fireEvent.click(screen.getByText('picker-pick'))

    expect(await screen.findByText('refresh failed')).toBeInTheDocument()
  })

  it('closes the picker without drawing when dismissed', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    renderExplorer()
    await startDrawing()

    fireEvent.click(screen.getByText('picker-close'))

    expect(screen.queryByText('relationship-target-picker')).not.toBeInTheDocument()
    expect(mockAddManual).not.toHaveBeenCalled()
  })

  it('removes a link from the detail card', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    mockDeleteManual.mockResolvedValue()
    renderExplorer()
    await screen.findByText('centre-orders')
    fireEvent.click(screen.getByText('centre-orders'))

    fireEvent.click(await screen.findByText('detail-remove-rel'))

    expect(mockDeleteManual).toHaveBeenCalledWith('p1', 'rel-1')
    // Removal refreshes the schema in place.
    await waitFor(() => expect(mockSchema).toHaveBeenCalledTimes(2))
  })

  it('surfaces an error when removing a link fails', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    mockDeleteManual.mockRejectedValueOnce(new Error('already gone'))
    renderExplorer()
    await screen.findByText('centre-orders')
    fireEvent.click(screen.getByText('centre-orders'))

    fireEvent.click(await screen.findByText('detail-remove-rel'))

    expect(await screen.findByText('already gone')).toBeInTheDocument()
  })

  it('undoes a just-drawn link and clears the notice', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    mockAddManual.mockResolvedValue({
      id: 'm1',
      source_schema: 'public',
      source_table: 'orders',
      source_column: 'customer_id',
      target_schema: 'public',
      target_table: 'active',
      target_column: 'id',
    })
    mockDeleteManual.mockResolvedValue()
    renderExplorer()
    await startDrawing()
    fireEvent.click(screen.getByText('picker-pick'))
    await screen.findByText('relationships.undo')

    fireEvent.click(screen.getByText('relationships.undo'))

    // Undo deletes the link just created and clears its notice.
    expect(mockDeleteManual).toHaveBeenCalledWith('p1', 'm1')
    await waitFor(() =>
      expect(screen.queryByText('relationships.added')).not.toBeInTheDocument(),
    )
  })

  it('dismisses the notice from its close button', async () => {
    mockSchema.mockResolvedValue(GRAPH)
    mockAddManual.mockResolvedValue({
      id: 'm1',
      source_schema: 'public',
      source_table: 'orders',
      source_column: 'customer_id',
      target_schema: 'public',
      target_table: 'active',
      target_column: 'id',
    })
    renderExplorer()
    await startDrawing()
    fireEvent.click(screen.getByText('picker-pick'))
    await screen.findByText('relationships.added')

    fireEvent.click(screen.getByLabelText('relationships.close'))

    expect(screen.queryByText('relationships.added')).not.toBeInTheDocument()
  })
})
