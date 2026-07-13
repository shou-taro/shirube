import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConnectionForm } from '@/components/connection/connection-form'
import { ProfilesList } from '@/components/connection/profiles-list'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { deleteProfile, listProfiles, type Profile } from '@/lib/api'

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

  const reload = useCallback(async () => {
    const loaded = await listProfiles()
    setProfiles(loaded)
    setView(loaded.length === 0 ? { mode: 'form', initial: null, editingId: null } : { mode: 'list' })
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleDelete(profile: Profile): Promise<void> {
    await deleteProfile(profile.id)
    await reload()
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2">
          <Logo className="size-7" />
          <span className="text-lg font-medium">{t('app.name')}</span>
        </div>
        <div className="rounded-xl border bg-card p-5">
          {profiles === null ? (
            <p className="text-sm text-muted-foreground">{t('connection.loading')}</p>
          ) : view.mode === 'form' ? (
            <>
              <h1 className="mb-4 text-base font-medium">{t('connection.newConnection')}</h1>
              <ConnectionForm
                initial={view.initial}
                editingId={view.editingId}
                onConnected={onConnected}
                onCancel={() => setView({ mode: 'list' })}
              />
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h1 className="text-base font-medium">{t('connection.savedConnections')}</h1>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setView({ mode: 'form', initial: null, editingId: null })}
                >
                  <Plus className="size-4" />
                  {t('connection.newConnection')}
                </Button>
              </div>
              <ProfilesList
                profiles={profiles}
                onConnect={onConnected}
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
