import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConnectionForm } from '@/components/connection/connection-form'
import { HeroBackdrop } from '@/components/connection/hero-backdrop'
import { ProfilesList } from '@/components/connection/profiles-list'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { deleteProfile, listProfiles, testProfileConnection, type Profile } from '@/lib/api'

type View =
  | { mode: 'list' }
  | { mode: 'form'; initial: Profile | null; editingId: string | null }

interface ConnectionScreenProps {
  onConnected: (profile: Profile) => void
}

/**
 * The pre-connection screen: a centred card showing either the saved-connections list
 * or the connection form. On first run (no saved connections) it opens straight into
 * the form.
 */
export function ConnectionScreen({ onConnected }: ConnectionScreenProps) {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [view, setView] = useState<View>({ mode: 'list' })
  // The profile currently being verified from the list, and any failure from that —
  // so connecting a saved-but-broken profile surfaces here rather than as an error on
  // the ER screen.
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const loaded = await listProfiles()
    setProfiles(loaded)
    setView(loaded.length === 0 ? { mode: 'form', initial: null, editingId: null } : { mode: 'list' })
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleConnect(profile: Profile): Promise<void> {
    setConnectError(null)
    setConnectingId(profile.id)
    try {
      // Verify before entering the explorer, using the profile's stored password.
      await testProfileConnection(profile.id)
      onConnected(profile)
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err))
      setConnectingId(null)
    }
  }

  async function handleDelete(profile: Profile): Promise<void> {
    await deleteProfile(profile.id)
    await reload()
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="grid w-full max-w-2xl overflow-hidden rounded-2xl border bg-card shadow-sm md:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Branded hero: the product's face on first run. Hidden on narrow screens,
            where the content column takes the full width. */}
        <aside className="brand-hero relative hidden flex-col justify-between overflow-hidden p-8 text-brand-foreground md:flex">
          <HeroBackdrop />
          <div className="relative flex items-center gap-3">
            <Logo className="size-9" />
            <span className="text-2xl font-medium tracking-tight">{t('app.name')}</span>
          </div>
          <p className="relative text-sm leading-relaxed text-brand-foreground">{t('app.tagline')}</p>
        </aside>

        {/* Content: the saved-connections list or the connection form. */}
        <div className="p-6 sm:p-8">
          {profiles === null ? (
            <p className="text-sm text-muted-foreground">{t('connection.loading')}</p>
          ) : view.mode === 'form' ? (
            <>
              <h1 className="mb-5 text-base font-medium">{t('connection.newConnection')}</h1>
              <ConnectionForm
                initial={view.initial}
                editingId={view.editingId}
                onConnected={onConnected}
                onCancel={() => setView({ mode: 'list' })}
              />
            </>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h1 className="text-base font-medium">{t('connection.savedConnections')}</h1>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setView({ mode: 'form', initial: null, editingId: null })}
                >
                  <Plus className="size-4" />
                  {t('connection.new')}
                </Button>
              </div>
              {connectError ? (
                <p className="mb-3 text-sm text-destructive">{connectError}</p>
              ) : null}
              <ProfilesList
                profiles={profiles}
                connectingId={connectingId}
                onConnect={(profile) => void handleConnect(profile)}
                onEdit={(profile) => setView({ mode: 'form', initial: profile, editingId: profile.id })}
                onDuplicate={(profile) =>
                  setView({
                    mode: 'form',
                    initial: { ...profile, name: `${profile.name} ${t('connection.copySuffix')}` },
                    editingId: null,
                  })
                }
                onDelete={(profile) => void handleDelete(profile)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
