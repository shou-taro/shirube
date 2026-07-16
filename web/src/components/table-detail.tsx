import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SchemaObject } from '@/lib/api'

/** A section heading within the panel, e.g. above the column list. */
function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  )
}

interface TableDetailProps {
  /** The table to describe — the current centre of the map. */
  object: SchemaObject
}

/**
 * The detail of the map's centre table: its columns, with primary keys flagged and
 * nullability marked. Fills the floating card in the workspace's top-left; the card owns
 * both the table's name (in its header) and scrolling, so this simply lays the columns
 * out top to bottom.
 */
export function TableDetail({ object }: TableDetailProps) {
  const { t } = useTranslation()
  return (
    <div className="pb-3">
      <SectionLabel>{t('schema.columns')}</SectionLabel>
      <ul>
        {object.columns.map((column) => (
          <li
            key={column.name}
            className="flex items-center gap-2 px-3 py-1 text-xs leading-[18px]"
          >
            {column.is_primary_key ? (
              <KeyRound className="size-3 shrink-0 text-brand" />
            ) : (
              <span className="size-3 shrink-0" aria-hidden />
            )}
            <span className="truncate" title={column.name}>
              {column.name}
            </span>
            {!column.nullable && (
              <span className="shrink-0 text-[9px] font-medium uppercase text-muted-foreground/70">
                {t('schema.notNull')}
              </span>
            )}
            <span
              className="ml-auto truncate text-muted-foreground"
              title={column.data_type}
            >
              {column.data_type}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
