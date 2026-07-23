import { useTranslation } from 'react-i18next'

import type { ObjectKind } from '@/lib/api'

/** The label shown for each non-table kind; a plain table gets no badge. */
const BADGE_KEY: Partial<Record<ObjectKind, string>> = {
  view: 'schema.badgeView',
  materialized_view: 'schema.badgeMatView',
  partitioned_table: 'schema.badgePartitioned',
}

/**
 * A small text tag marking an object's kind when it is not a plain table — "view",
 * "mat. view" or "partitioned". Tables get nothing, since they are the default; so
 * wherever a schema object is named, this quietly disambiguates the derived ones without
 * leaning on icon literacy. Renders nothing for tables.
 */
export function KindBadge({ kind }: { kind: ObjectKind }) {
  const { t } = useTranslation()
  const labelKey = BADGE_KEY[kind]
  if (labelKey === undefined) {
    return null
  }
  const label = t(labelKey)
  return (
    <span className="shrink-0 rounded-sm border border-brand/30 bg-card px-1 text-[9px] font-semibold uppercase tracking-wide text-brand">
      {label}
    </span>
  )
}
