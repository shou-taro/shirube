import {
  ArrowUp,
  Database,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErDiagram } from '@/components/er/er-diagram'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { fetchHealth, fetchSchema, type Profile, type SchemaGraph } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Outcome of the start-up backend health check, used to render the status indicator. */
type HealthState =
  | { status: 'checking' }
  | { status: 'ok'; version: string }
  | { status: 'error' }

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
  const [health, setHealth] = useState<HealthState>({ status: 'checking' })
  const [schema, setSchema] = useState<SchemaState>({ status: 'loading' })
  const [detailOpen, setDetailOpen] = useState(true)
  const [navigatorOpen, setNavigatorOpen] = useState(true)

  useEffect(() => {
    fetchHealth()
      .then((response) => setHealth({ status: 'ok', version: response.version }))
      .catch(() => setHealth({ status: 'error' }))
  }, [])

  const loadSchema = useCallback(() => {
    setSchema({ status: 'loading' })
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

  const healthLabel =
    health.status === 'ok'
      ? t('health.connected', { version: health.version })
      : health.status === 'error'
        ? t('health.error')
        : t('health.checking')

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-3">
        <span className="flex items-center gap-1.5 font-medium">
          <Logo className="size-5" />
          {t('app.name')}
        </span>
        <span className="h-5 w-px bg-border" />
        {/* The connected profile; clicking it returns to the connection screen. */}
        <button
          type="button"
          onClick={onDisconnect}
          title={t('connection.disconnect')}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent"
        >
          <Database className="size-3.5 text-brand" />
          <span className="text-sm font-medium">{profile.name}</span>
          <span className="text-xs text-muted-foreground">{profile.database}</span>
        </button>

        {/* Search — a placeholder for now; wired up with the search feature. */}
        <span className="mx-auto flex h-8 w-full max-w-md items-center gap-2 rounded-lg border bg-muted/40 px-2.5 text-sm text-muted-foreground">
          <Search className="size-3.5 shrink-0" />
          <span className="truncate">{t('search.placeholder')}</span>
        </span>

        <span
          title={healthLabel}
          className="flex items-center"
          role="img"
          aria-label={healthLabel}
        >
          <span
            className={cn(
              'size-2 rounded-full',
              health.status === 'ok'
                ? 'bg-green-500'
                : health.status === 'error'
                  ? 'bg-red-500'
                  : 'bg-amber-500',
            )}
          />
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('schema.retry')}
          onClick={loadSchema}
          disabled={schema.status === 'loading'}
        >
          <RefreshCw className={cn('size-4', schema.status === 'loading' && 'animate-spin')} />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Settings">
          <Settings className="size-4" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 bg-muted/30">
        {/* Left pane: the selected table's detail — a card floating over the canvas,
            collapsible to a slim toggle. */}
        {detailOpen ? (
          <aside className="w-64 shrink-0 p-2">
            <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="flex h-9 items-center border-b pl-3 pr-1.5 text-xs font-medium text-muted-foreground">
                <span className="flex-1">{t('panes.detail')}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => setDetailOpen(false)}
                  aria-label={t('panes.collapse')}
                >
                  <PanelLeftClose className="size-3.5" />
                </Button>
              </div>
              <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
                {t('panes.detailEmpty')}
              </div>
            </div>
          </aside>
        ) : (
          <div className="shrink-0 p-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDetailOpen(true)}
              aria-label={t('panes.expand')}
              title={t('panes.detail')}
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          </div>
        )}

        {/* Centre: the ER map — the canvas itself. */}
        <main className="min-w-0 flex-1">
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
            <ErDiagram graph={schema.graph} />
          )}
        </main>

        {/* Right pane: the AI navigator (Milestone 2) — docked so chat gets the full
            height, collapsible to a slim rail. */}
        {navigatorOpen ? (
          <aside className="flex w-72 shrink-0 flex-col border-l bg-card">
            <div className="flex h-9 items-center gap-1.5 border-b pl-3 pr-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-brand" />
              <span className="flex-1">{t('panes.chat')}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => setNavigatorOpen(false)}
                aria-label={t('panes.collapse')}
              >
                <PanelRightClose className="size-3.5" />
              </Button>
            </div>
            <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
              {t('panes.chatIntro')}
            </div>
            <div className="border-t p-2.5">
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
        ) : (
          <div className="shrink-0 border-l bg-card p-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setNavigatorOpen(true)}
              aria-label={t('panes.expand')}
              title={t('panes.chat')}
            >
              <Sparkles className="size-4 text-brand" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
