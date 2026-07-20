import {
  Database,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Table2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataDrawer } from '@/components/data-drawer'
import { ErDiagram } from '@/components/er/er-diagram'
import { KindBadge } from '@/components/kind-badge'
import { Logo } from '@/components/logo'
import { NavigatorPane } from '@/components/navigator-pane'
import { SchemaSearch } from '@/components/schema-search'
import { SettingsDialog } from '@/components/settings-dialog'
import { TableDetail } from '@/components/table-detail'
import { Button } from '@/components/ui/button'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { type AiProvider, fetchAiProvider, fetchSchema, type Profile, type SchemaGraph } from '@/lib/api'
import { revokeDestination, loadApprovedDestinations, approveDestination } from '@/lib/destinations'
import { DETAIL_PANE, NAVIGATOR_PANE } from '@/lib/panes'
import { buildObjectResolver } from '@/lib/schema-refs'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

/** The schema load for the connected profile. */
type SchemaState =
  | { status: 'loading' }
  | { status: 'ready'; graph: SchemaGraph }
  | { status: 'error'; message: string }

interface ExplorerProps {
  /** The connected profile. */
  profile: Profile
  /** Return to the connection screen. */
  onDisconnect: () => void
}

/**
 * The three-pane workspace — table detail (left), the ER map (centre) and the AI
 * navigator (right) — beneath a top bar. The centre draws the introspected schema; the
 * side panes are filled in by later feature work (table detail, the AI).
 */
export function Explorer({ profile, onDisconnect }: ExplorerProps) {
  const { t } = useTranslation()
  const { settings, update } = useSettings()
  const [schema, setSchema] = useState<SchemaState>({ status: 'loading' })
  const [navigatorOpen, setNavigatorOpen] = useState(true)
  // Which settings group to open on — the navigator's provider line points straight at its
  // own setting rather than dropping the user at the top of the dialog.
  const [settingsOpen, setSettingsOpen] = useState<false | 'appearance' | 'ai'>(false)
  // True while a pane edge is being dragged, so its width follows the pointer without a
  // transition smoothing it out.
  const [resizing, setResizing] = useState(false)
  // The configured AI provider for the navigator pane; reloaded whenever settings close, so
  // a just-saved provider takes effect at once. `undefined` while first loading.
  const [provider, setProvider] = useState<AiProvider | null | undefined>(undefined)
  // Destinations the user has agreed the navigator may send the schema to (persisted).
  const [approved, setApproved] = useState<string[]>(loadApprovedDestinations)
  // Whether the bottom row-preview drawer is showing (for the current centre object).
  const [dataOpen, setDataOpen] = useState(false)
  // A table chosen via search to centre the ER map on; null lets the map pick the backbone.
  const [centreOverride, setCentreOverride] = useState<string | null>(null)
  // The id of the map's current centre, reported by the ER map; drives the detail card.
  const [centreId, setCentreId] = useState<string | null>(null)

  // The loaded schema (when ready). View-dependency edges are dropped when the setting is
  // off, so the map and detail panel fall back to foreign keys only.
  const readyGraph = schema.status === 'ready' ? schema.graph : null
  const displayGraph = useMemo(() => {
    if (readyGraph === null || settings.showViewDependencies) {
      return readyGraph
    }
    return {
      ...readyGraph,
      relationships: readyGraph.relationships.filter(
        (relationship) => relationship.kind !== 'view_dependency',
      ),
    }
  }, [readyGraph, settings.showViewDependencies])
  const centreObject = displayGraph?.objects.find((object) => object.id === centreId) ?? null
  // Lets the navigator recognise the objects it names in an answer and link them to the map.
  const resolveRef = useMemo(
    () => buildObjectResolver(displayGraph?.objects ?? []),
    [displayGraph],
  )

  const loadSchema = useCallback(() => {
    setSchema({ status: 'loading' })
    setCentreOverride(null)
    fetchSchema(profile.id)
      .then((graph) => setSchema({ status: 'ready', graph }))
      .catch((error: unknown) =>
        setSchema({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
      )
  }, [profile.id])

  useEffect(() => {
    loadSchema()
  }, [loadSchema])

  // Load the configured provider (null when none is set); a failure is treated as unset.
  const loadProvider = useCallback(() => {
    fetchAiProvider()
      .then((next) => setProvider(next))
      .catch(() => setProvider(null))
  }, [])

  useEffect(() => {
    loadProvider()
  }, [loadProvider])

  // Reload the provider and approved list when settings close, so any change made there —
  // configuring a provider or revoking a destination — shows in the navigator at once.
  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    loadProvider()
    setApproved(loadApprovedDestinations())
  }, [loadProvider])

  const approve = useCallback(
    (id: string) => setApproved((current) => approveDestination(current, id)),
    [],
  )
  const revoke = useCallback(
    (id: string) => setApproved((current) => revokeDestination(current, id)),
    [],
  )

  // Clear the search/navigation override once the map has arrived at it, so selecting the
  // same table again later still re-triggers a travel (a repeated value would not).
  useEffect(() => {
    if (centreOverride !== null && centreId === centreOverride) {
      setCentreOverride(null)
    }
  }, [centreId, centreOverride])

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-[var(--topbar)] px-3">
        <span className="flex items-center gap-1.5 font-medium">
          <Logo className="size-5" />
          {t('app.name')}
        </span>

        {/* Search recentres the map; it needs the schema, so before it loads a plain
            disabled placeholder holds the slot. */}
        {schema.status === 'ready' ? (
          <SchemaSearch objects={schema.graph.objects} onSelect={setCentreOverride} />
        ) : (
          <span className="mx-auto flex h-8 w-full max-w-md items-center gap-2 rounded-lg border bg-background/85 px-2.5 text-sm text-muted-foreground">
            <Search className="size-3.5 shrink-0" />
            <span className="truncate">{t('search.placeholder')}</span>
          </span>
        )}

        {/* Connection: a pill grouping the active connection with a refresh for its
            schema, so the two read as one unit rather than loose icons. */}
        <div className="flex items-center rounded-md border bg-background/60">
          <button
            type="button"
            onClick={onDisconnect}
            title={t('connection.disconnect')}
            className="flex items-center gap-1.5 rounded-l-md py-1 pl-2.5 pr-2 hover:bg-brand/15"
          >
            <Database className="size-3.5 text-brand" />
            <span className="text-sm font-medium">{profile.name}</span>
            <span className="text-xs text-muted-foreground">{profile.database}</span>
          </button>
          <span className="h-5 w-px bg-border" />
          <button
            type="button"
            onClick={loadSchema}
            disabled={schema.status === 'loading'}
            aria-label={t('schema.reload')}
            title={t('schema.reload')}
            className="flex items-center rounded-r-md px-2 py-1.5 hover:bg-brand/15 disabled:opacity-50"
          >
            <RefreshCw className={cn('size-3.5', schema.status === 'loading' && 'animate-spin')} />
          </button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="hover:bg-brand/15 hover:text-brand"
          aria-label={t('settings.title')}
          title={t('settings.title')}
          onClick={() => setSettingsOpen('appearance')}
        >
          <Settings className="size-4" />
        </Button>
        {/* Navigator toggle: the Sparkles marks the AI pane, the trailing panel icon
            shows it collapses (open) or expands (closed). Brand-tinted when open, so it
            stays distinct from the neutral connection pill. */}
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'gap-1 hover:bg-brand/15 hover:text-brand',
            navigatorOpen && 'bg-brand/15 text-brand hover:bg-brand/20',
          )}
          aria-pressed={navigatorOpen}
          title={navigatorOpen ? t('panes.collapse') : t('panes.expand')}
          onClick={() => setNavigatorOpen((open) => !open)}
        >
          <Sparkles className="size-4 text-brand" />
          {navigatorOpen ? (
            <PanelRightClose className="size-4 text-muted-foreground" />
          ) : (
            <PanelRightOpen className="size-4 text-muted-foreground" />
          )}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Centre: the ER map (top) above the row-preview drawer (bottom); the
            table-detail card floats over the map. */}
        <div className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="relative min-h-0 flex-1">
          {schema.status === 'loading' ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('schema.loading')}
            </div>
          ) : schema.status === 'error' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
              <p className="text-destructive">{schema.message || t('schema.error')}</p>
              <Button variant="outline" size="sm" onClick={loadSchema}>
                {t('schema.retry')}
              </Button>
            </div>
          ) : schema.graph.objects.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {t('schema.empty')}
            </div>
          ) : displayGraph ? (
            <ErDiagram
              graph={displayGraph}
              centreOverride={centreOverride}
              onCentreChange={setCentreId}
              defaultShowAll={settings.defaultView === 'all'}
              // Refit the map when the space it has changes — including after a pane drag
              // ends, but not on every pixel of one.
              resizeKey={`${navigatorOpen}:${dataOpen}:${resizing ? 'drag' : settings.navigatorWidth}`}
            />
          ) : null}

          {/* Floating table-detail card: hugs its content and caps at the pane height,
              scrolling within. Each section inside collapses on its own. Shown only when
              there is a diagram to detail — hidden while loading, on error, and for an
              empty schema, where a "select a table" prompt would contradict the centre's
              "no tables or views" message. */}
          {schema.status === 'ready' && schema.graph.objects.length > 0 && (
          <div
            style={{ width: settings.detailWidth }}
            className="absolute left-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-brand/20 bg-card shadow-md"
          >
            {/* The card floats over the map, so its handle rides its right edge. */}
            <ResizeHandle
              edge="right"
              width={settings.detailWidth}
              size={DETAIL_PANE}
              onResize={(detailWidth) => update({ detailWidth })}
              label={t('panes.resizeDetail')}
            />
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-brand/20 bg-brand/15 px-3 text-xs font-medium text-foreground">
              {centreObject ? (
                <>
                  <span className="min-w-0 truncate" title={centreObject.name}>
                    {centreObject.name}
                  </span>
                  <KindBadge kind={centreObject.kind} />
                  <span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground">
                    {centreObject.schema}
                  </span>
                </>
              ) : (
                <span>{t('panes.detail')}</span>
              )}
            </div>
            {displayGraph && centreObject ? (
              <div className="min-h-0 overflow-y-auto">
                <TableDetail
                  object={centreObject}
                  graph={displayGraph}
                  onNavigate={setCentreOverride}
                />
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-muted-foreground">
                {t('panes.detailEmpty')}
              </div>
            )}
            {/* Footer: reveal the current table's rows in the drawer below. */}
            {centreObject && (
              <button
                type="button"
                onClick={() => setDataOpen((open) => !open)}
                aria-pressed={dataOpen}
                className={cn(
                  'flex shrink-0 items-center justify-center gap-1.5 border-t border-brand/20 px-3 py-2 text-xs font-medium hover:bg-brand/10',
                  dataOpen && 'bg-brand/15 text-brand',
                )}
              >
                <Table2 className="size-3.5" />
                {t('data.view')}
              </button>
            )}
          </div>
          )}
          </div>

          {/* Bottom: the row-preview drawer for the current centre object. */}
          <DataDrawer
            profileId={profile.id}
            object={centreObject}
            open={dataOpen}
            onClose={() => setDataOpen(false)}
          />
        </div>

        {/* Right pane: the AI navigator (Milestone 2) — docked so chat gets the full
            height; it slides open and closed, toggled from the top bar. */}
        <div
          style={{ width: navigatorOpen ? settings.navigatorWidth : 0 }}
          className={cn(
            'relative shrink-0 overflow-hidden ease-out',
            // The open/close slide is animated, but a drag must not lag behind the pointer.
            resizing ? 'transition-none' : 'transition-[width] duration-200',
          )}
        >
          {/* The pane is docked to the right, so it widens by dragging its left edge. */}
          {navigatorOpen && (
            <ResizeHandle
              edge="left"
              width={settings.navigatorWidth}
              size={NAVIGATOR_PANE}
              onResize={(navigatorWidth) => update({ navigatorWidth })}
              onDragChange={setResizing}
              label={t('panes.resizeNavigator')}
            />
          )}
          <NavigatorPane
            // Keyed by profile so switching connections remounts the pane on that
            // profile's own conversation rather than carrying one across.
            key={profile.id}
            profileId={profile.id}
            provider={provider ?? null}
            providerLoading={provider === undefined}
            approved={approved}
            onApprove={approve}
            onOpenSettings={() => setSettingsOpen('ai')}
            width={settings.navigatorWidth}
            resolveRef={resolveRef}
            onNavigate={setCentreOverride}
          />
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen !== false}
        initialCategory={settingsOpen === false ? undefined : settingsOpen}
        onClose={closeSettings}
        approved={approved}
        onRevoke={revoke}
      />
    </div>
  )
}
