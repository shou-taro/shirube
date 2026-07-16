import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ConnectionScreen } from '@/components/connection/connection-screen'
import { Explorer } from '@/components/explorer'
import { listProfiles, type Profile } from '@/lib/api'
// Remembers the last connected profile across reloads. Only the id is stored — the
// password stays in the OS keychain, and the profile is re-validated on load.
import { ACTIVE_PROFILE_KEY } from '@/lib/storage'

/**
 * Root of the app: show the connection screen until a profile is chosen, then the
 * explorer for that connection. Disconnecting returns to the connection screen.
 *
 * The active connection is remembered across reloads: on load, a stored profile id is
 * looked up among the saved profiles and reconnected if it still exists, so a refresh
 * lands back on the map rather than the connection screen.
 */
export default function App() {
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null)
  // True while checking storage for a profile to restore, so we don't flash the
  // connection screen before reconnecting.
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    const storedId = localStorage.getItem(ACTIVE_PROFILE_KEY)
    if (storedId === null) {
      setRestoring(false)
      return
    }
    // Reconnect only if the remembered profile is still there; otherwise forget it.
    listProfiles()
      .then((profiles) => {
        const match = profiles.find((profile) => profile.id === storedId) ?? null
        if (match === null) {
          localStorage.removeItem(ACTIVE_PROFILE_KEY)
        }
        setActiveProfile(match)
      })
      .catch(() => {
        // Leave disconnected on failure; the connection screen can retry.
      })
      .finally(() => setRestoring(false))
  }, [])

  function connect(profile: Profile): void {
    localStorage.setItem(ACTIVE_PROFILE_KEY, profile.id)
    setActiveProfile(profile)
  }

  function disconnect(): void {
    localStorage.removeItem(ACTIVE_PROFILE_KEY)
    setActiveProfile(null)
  }

  if (restoring) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-brand" />
      </div>
    )
  }

  return activeProfile ? (
    <Explorer profile={activeProfile} onDisconnect={disconnect} />
  ) : (
    <ConnectionScreen onConnected={connect} />
  )
}
