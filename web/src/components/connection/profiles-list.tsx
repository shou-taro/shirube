import { Copy, Database, MoreHorizontal, Pencil, Plug, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Profile } from '@/lib/api'

interface ProfilesListProps {
  profiles: Profile[]
  onConnect: (profile: Profile) => void
  onEdit: (profile: Profile) => void
  onDuplicate: (profile: Profile) => void
  onDelete: (profile: Profile) => void
}

/**
 * The list of saved connections. Each connection is a clickable tile — clicking it (or
 * the trailing arrow) connects — with the secondary actions (duplicate, edit, delete)
 * tucked behind a single overflow menu. The list scrolls within a fixed height, so the
 * card keeps a steady size however many connections are saved.
 */
export function ProfilesList({
  profiles,
  onConnect,
  onEdit,
  onDuplicate,
  onDelete,
}: ProfilesListProps) {
  const { t } = useTranslation()
  return (
    <ul className="-mr-2 flex h-64 flex-col gap-1.5 overflow-y-auto pr-2">
      {profiles.map((profile) => (
        <li
          key={profile.id}
          className="group relative flex items-center rounded-lg border bg-background transition-colors hover:border-brand/50 hover:bg-brand/10"
        >
          <button
            type="button"
            onClick={() => onConnect(profile)}
            className="flex flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Database className="size-4 shrink-0 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{profile.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {profile.host}:{profile.port} · {profile.database}
              </span>
            </span>
            <Plug className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-brand" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="mr-1 size-8 shrink-0 text-muted-foreground hover:bg-brand/15 hover:text-brand"
                aria-label={t('connection.rowActions')}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onDuplicate(profile)}>
                <Copy />
                {t('connection.duplicate')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onEdit(profile)}>
                <Pencil />
                {t('connection.edit')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(profile)}>
                <Trash2 />
                {t('connection.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      ))}
    </ul>
  )
}
