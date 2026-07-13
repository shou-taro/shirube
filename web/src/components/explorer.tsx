import { Database, Loader2, RefreshCw, Search, Settings } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErDiagram } from '@/components/er/er-diagram'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { fetchHealth, fetchSchema, type Profile, type SchemaGraph } from '@/lib/api'

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
      <header className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <Logo className="size-5" />
          {t('app.name')}
        </span>
        {/* The connected profile; clicking it returns to the connection screen. */}
        <button
          type="button"
          onClick={onDisconnect}
          title={t('connection.disconnect')}
          className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-muted-foreground hover:bg-accent"
        >
          <Database className="size-3.5" />
          {profile.name}
        </button>
        <span className="flex flex-1 items-center gap-1.5 rounded-md border px-2.5 py-1 text-muted-foreground">
          <Search className="size-3.5" />
          {t('search.placeholder')}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{healthLabel}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('schema.retry')}
          onClick={loadSchema}
          disabled={schema.status === 'loading'}
        >
          <RefreshCw className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Settings">
          <Settings className="size-4" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 border-r p-3 text-sm text-muted-foreground">
          {t('panes.detail')}
        </aside>
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
        <aside className="flex w-72 shrink-0 flex-col border-l p-3 text-sm">
          <div className="text-muted-foreground">{t('panes.chat')}</div>
          <div className="flex-1" />
          <div className="rounded-md border px-2.5 py-2 text-muted-foreground">
            {t('chat.inputPlaceholder')}
          </div>
        </aside>
      </div>
    </div>
  )
}
