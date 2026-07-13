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
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="grid w-full max-w-3xl overflow-hidden rounded-2xl border bg-card shadow-sm md:grid-cols-[16rem_1fr]">
        {/* Branded hero: the product's face on first run. Hidden on narrow screens,
            where the content column takes the full width. */}
        <aside className="hidden flex-col justify-between bg-brand-panel p-8 text-white md:flex">
          <div className="flex flex-col gap-3">
            <Logo className="size-8" />
            <div>
              <div className="text-lg font-medium leading-none">{t('app.name')}</div>
              {/* The Japanese written form — 標べ, "a guide, a signpost". */}
              <div className="mt-1.5 text-sm text-white/70">標べ</div>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-white/80">{t('app.tagline')}</p>
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
