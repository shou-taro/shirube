import { useState } from 'react'

import { ConnectionScreen } from '@/components/connection/connection-screen'
import { Explorer } from '@/components/explorer'
import type { Profile } from '@/lib/api'

/**
 * Root of the app: show the connection screen until a profile is chosen, then the
 * explorer for that connection. Disconnecting returns to the connection screen.
 */
export default function App() {
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null)

  return activeProfile ? (
    <Explorer profile={activeProfile} onDisconnect={() => setActiveProfile(null)} />
  ) : (
    <ConnectionScreen onConnected={setActiveProfile} />
  )
}
