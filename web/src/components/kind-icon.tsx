import { Eye, Table2 } from 'lucide-react'

import type { ObjectKind } from '@/lib/api'

/**
 * The leading icon for a schema object in a tree: a table (or partitioned table) reads as
 * a grid, a view or materialized view as an eye. Shared by the browse tree and the
 * relationship picker so objects read the same in both.
 */
export function KindIcon({ kind }: { kind: ObjectKind }) {
  const Icon = kind === 'view' || kind === 'materialized_view' ? Eye : Table2
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
}
