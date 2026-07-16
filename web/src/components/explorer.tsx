import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Database,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErDiagram } from '@/components/er/er-diagram'
import { Logo } from '@/components/logo'
import { SchemaSearch } from '@/components/schema-search'
import { TableDetail } from '@/components/table-detail'
import { Button } from '@/components/ui/button'
import { fetchSchema, type Profile, type SchemaGraph } from '@/lib/api'
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
  const [schema, setSchema] = useState<SchemaState>({ status: 'loading' })
  const [detailExpanded, setDetailExpanded] = useState(false)
  const [navigatorOpen, setNavigatorOpen] = useState(true)
  // A table chosen via search to centre the ER map on; null lets the map pick the backbone.
  const [centreOverride, setCentreOverride] = useState<string | null>(null)
  // The id of the map's current centre, reported by the ER map; drives the detail card.
  const [centreId, setCentreId] = useState<string | null>(null)

  // The centre table itself, resolved from the loaded schema.
  const centreObject =
    schema.status === 'ready'
      ? (schema.graph.objects.find((object) => object.id === centreId) ?? null)
      : null

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

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-[#e9e3fb] px-3">
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
          aria-label="Settings"
          title="Settings"
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
        {/* Centre: the ER map canvas, with the table-detail card floating over it. */}
        <div className="relative min-w-0 flex-1 bg-background">
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
          ) : (
            <ErDiagram
              graph={schema.graph}
              centreOverride={centreOverride}
              onCentreChange={setCentreId}
              resizeKey={navigatorOpen}
            />
          )}

          {/* Floating table-detail card: compact by default, expandable downwards to
              give a selected table's detail room to breathe. */}
          <div
            className={cn(
              'absolute left-3 top-3 z-10 flex w-64 flex-col overflow-hidden rounded-xl border border-brand/20 bg-card shadow-md',
              detailExpanded && 'bottom-3',
            )}
          >
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-brand/20 bg-brand/15 pl-3 pr-1.5 text-xs font-medium text-brand-foreground">
              {centreObject ? (
                <>
                  <span className="truncate" title={centreObject.name}>
                    {centreObject.name}
                  </span>
                  <span className="truncate text-[11px] font-normal text-brand-foreground/60">
                    {centreObject.schema}
                  </span>
                </>
              ) : (
                <span className="flex-1">{t('panes.detail')}</span>
              )}
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => setDetailExpanded((expanded) => !expanded)}
                aria-label={detailExpanded ? t('panes.collapse') : t('panes.expand')}
              >
                {detailExpanded ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </Button>
            </div>
            {centreObject ? (
              <div
                className={cn(
                  'overflow-y-auto',
                  detailExpanded ? 'flex-1' : 'max-h-[45vh]',
                )}
              >
                <TableDetail object={centreObject} />
              </div>
            ) : (
              <div
                className={cn(
                  'p-6 text-center text-xs text-muted-foreground',
                  detailExpanded && 'flex flex-1 items-center justify-center overflow-y-auto',
                )}
              >
                {t('panes.detailEmpty')}
              </div>
            )}
          </div>
        </div>

        {/* Right pane: the AI navigator (Milestone 2) — docked so chat gets the full
            height; it slides open and closed, toggled from the top bar. */}
        <div
          className={cn(
            'shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
            navigatorOpen ? 'w-72' : 'w-0',
          )}
        >
          <aside className="flex h-full w-72 flex-col border-l border-brand/20 bg-brand/10">
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
              <Sparkles className="size-5 text-brand" />
              {t('panes.chatIntro')}
            </div>
            <div className="p-2.5">
              <div className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5">
                <span className="flex-1 truncate text-sm text-muted-foreground">
                  {t('chat.inputPlaceholder')}
                </span>
                <Button
                  variant="brand"
                  size="icon"
                  className="size-7"
                  disabled
                  aria-label={t('chat.send')}
                >
                  <ArrowUp className="size-4" />
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
