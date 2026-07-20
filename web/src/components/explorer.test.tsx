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
vi.mock('@/components/table-detail', () => ({ TableDetail: () => <div>table-detail</div> }))
vi.mock('@/components/schema-search', () => ({
  SchemaSearch: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('public.orders')}>
      search-orders
    </button>
  ),
}))
vi.mock('@/components/ui/resize-handle', () => ({ ResizeHandle: () => <div>resize-handle</div> }))

import { Explorer } from '@/components/explorer'
import { fetchAiProvider, fetchSchema } from '@/lib/api'
import { SettingsProvider } from '@/lib/settings'
import { SETTINGS_KEY } from '@/lib/storage'

const mockSchema = vi.mocked(fetchSchema)
const mockProvider = vi.mocked(fetchAiProvider)

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
  erProps.mockClear()
  navProps.mockClear()
  settingsProps.mockClear()
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
})
