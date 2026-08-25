/**
 * Mounts the real Explorer for the landing-page demo.
 *
 * This is shirube's actual workspace, unchanged — the map, table detail, schema tree,
 * search and route finder are the real components, driven by the bundled Chinook fixtures
 * through the API mock. The only thing it adds is a listener so the embedding page can push
 * its light/dark theme in as the visitor toggles it.
 */
import { useEffect } from 'react'

import { Explorer } from '@/components/explorer'
import type { Profile } from '@/lib/api'
import { useSettings } from '@/lib/settings'

import { DemoNavigator } from './DemoNavigator'

const DEMO_PROFILE: Profile = {
  kind: 'sqlite',
  id: 'demo',
  name: 'Sample database (Chinook)',
  path: 'chinook.sqlite',
  schemas: [],
}

export function DemoApp() {
  const { update } = useSettings()

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; theme?: string } | null
      if (data?.type === 'shirube-demo-theme' && (data.theme === 'dark' || data.theme === 'light')) {
        update({ theme: data.theme })
      }
    }
    window.addEventListener('message', onMessage)
    // Tell the parent we are ready, so it can send the current theme straight away.
    window.parent?.postMessage({ type: 'shirube-demo-ready' }, '*')
    return () => window.removeEventListener('message', onMessage)
  }, [update])

  return (
    <Explorer
      profile={DEMO_PROFILE}
      onDisconnect={() => {}}
      renderNavigator={({ onNavigate }) => <DemoNavigator onNavigate={onNavigate} />}
    />
  )
}
