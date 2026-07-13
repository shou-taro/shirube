import { ChevronRight, Copy, Database, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { Profile } from '@/lib/api'

interface ProfilesListProps {
  profiles: Profile[]
  onConnect: (profile: Profile) => void
  onEdit: (profile: Profile) => void
  onDuplicate: (profile: Profile) => void
  onDelete: (profile: Profile) => void
}

/** The list of saved connections; clicking a row connects, with per-row actions. */
export function ProfilesList({
  profiles,
  onConnect,
  onEdit,
  onDuplicate,
  onDelete,
}: ProfilesListProps) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-col divide-y">
      {profiles.map((profile) => (
        <li key={profile.id} className="flex items-center gap-2 py-2.5">
          <Database className="size-4 shrink-0 text-muted-foreground" />
          <button
            type="button"
            onClick={() => onConnect(profile)}
            className="flex flex-1 items-center gap-2 text-left"
          >
            <span className="flex-1">
              <span className="block text-sm font-medium">{profile.name}</span>
              <span className="block text-xs text-muted-foreground">
                {profile.host}:{profile.port} · {profile.database}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('connection.duplicate')}
            onClick={() => onDuplicate(profile)}
          >
            <Copy className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('connection.edit')}
            onClick={() => onEdit(profile)}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('connection.delete')}
            onClick={() => onDelete(profile)}
          >
            <Trash2 className="size-4" />
          </Button>
        </li>
      ))}
    </ul>
  )
}
