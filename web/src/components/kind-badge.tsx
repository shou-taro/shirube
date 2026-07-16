import { useTranslation } from 'react-i18next'

import type { ObjectKind } from '@/lib/api'

/**
 * A small text tag marking an object's kind when it is not a plain table — "view" or
 * "mat. view". Tables get nothing, since they are the default; so wherever a schema
 * object is named, this quietly disambiguates the derived ones without leaning on icon
 * literacy. Renders nothing for tables.
 */
export function KindBadge({ kind }: { kind: ObjectKind }) {
  const { t } = useTranslation()
  if (kind === 'table') {
    return null
  }
  const label = kind === 'view' ? t('schema.badgeView') : t('schema.badgeMatView')
  return (
    <span className="shrink-0 rounded-sm border border-brand/30 bg-card px-1 text-[9px] font-semibold uppercase tracking-wide text-brand">
      {label}
    </span>
  )
}
