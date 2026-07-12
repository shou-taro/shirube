import { Background, Controls, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Database, RefreshCw, Search, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { fetchHealth } from '@/lib/api'

/** Outcome of the start-up backend health check, used to render the status indicator. */
type HealthState =
  | { status: 'checking' }
  | { status: 'ok'; version: string }
  | { status: 'error' }

/**
 * Root application shell.
 *
 * Lays out the three-pane workspace — table detail (left), the ER map (centre) and the
 * AI navigator (right) — beneath a top bar. This is a placeholder skeleton: the panes
 * are filled in by later feature work. On mount it pings the backend once so the top
 * bar can show whether the API is reachable.
 */
export default function App() {
  const { t } = useTranslation()
  const [health, setHealth] = useState<HealthState>({ status: 'checking' })

  // Confirm the backend is reachable once, on first render.
  useEffect(() => {
    fetchHealth()
      .then((response) => setHealth({ status: 'ok', version: response.version }))
      .catch(() => setHealth({ status: 'error' }))
  }, [])

  const healthLabel =
    health.status === 'ok'
      ? t('health.connected', { version: health.version })
      : health.status === 'error'
        ? t('health.error')
        : t('health.checking')

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar: brand, current connection, search, health status, and global actions. */}
      <header className="flex items-center gap-2 border-b px-3 py-2 text-sm">
        <span className="font-medium">{t('app.name')}</span>
        <span className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-muted-foreground">
          <Database className="size-3.5" />
          {t('connection.placeholder')}
        </span>
        <span className="flex flex-1 items-center gap-1.5 rounded-md border px-2.5 py-1 text-muted-foreground">
          <Search className="size-3.5" />
          {t('search.placeholder')}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{healthLabel}</span>
        <Button variant="ghost" size="icon" aria-label="Refresh schema">
          <RefreshCw className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Settings">
          <Settings className="size-4" />
        </Button>
      </header>

      {/* Three panes. `min-h-0` lets the row shrink so the map can own the space. */}
      <div className="flex min-h-0 flex-1">
        {/* Left: details of the selected table. */}
        <aside className="w-56 shrink-0 border-r p-3 text-sm text-muted-foreground">
          {t('panes.detail')}
        </aside>
        {/* Centre: the ER map — an empty React Flow canvas for now. */}
        <main className="min-w-0 flex-1">
          <ReactFlow nodes={[]} edges={[]} fitView>
            <Background />
            <Controls />
          </ReactFlow>
        </main>
        {/* Right: the AI navigator chat. */}
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
