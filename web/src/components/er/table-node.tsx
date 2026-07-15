import { Handle, type NodeProps, Position } from '@xyflow/react'
import { Eye, KeyRound, Layers, Table2 } from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import type { ObjectKind } from '@/lib/api'

import type { TableFlowNode } from './layout'

// One icon per object kind, so tables, views and materialized views read apart at a
// glance on the map.
const KIND_ICON: Record<ObjectKind, ComponentType<{ className?: string }>> = {
  table: Table2,
  view: Eye,
  materialized_view: Layers,
}

/**
 * A stub marking related tables off the map, drawn vertically so it stays clear of the
 * horizontal foreign-key edges: above the node for tables it references, below for
 * tables that reference it. A short line and a table-icon count.
 */
function HiddenStub({ side, count, label }: { side: 'top' | 'bottom'; count: number; label: string }) {
  const line = <span className="h-4 w-px bg-brand/50" />
  const chip = (
    <span className="flex items-center gap-0.5 rounded-full border border-brand/40 bg-card px-1.5 py-0.5 text-[10px] font-medium text-brand shadow-sm">
      <Table2 className="size-2.5 shrink-0" />
      {count}
    </span>
  )
  return (
    <div
      className={cn(
        'pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center',
        side === 'top' ? 'bottom-full' : 'top-full',
      )}
      title={label}
    >
      {side === 'top' ? (
        <>
          {chip}
          {line}
        </>
      ) : (
        <>
          {line}
          {chip}
        </>
      )}
    </div>
  )
}

/**
 * A schema object as a card on the ER map: a titled header with a kind icon, above the
 * list of columns. Primary-key columns are flagged, and the type sits to the right.
 * Left and right handles anchor the foreign-key edges.
 *
 * The centre of the neighbourhood is ringed for emphasis. Neighbours are clickable —
 * clicking one recentres the map on it — so they lift on hover to read as interactive.
 */
export function TableNode({ data }: NodeProps<TableFlowNode>) {
  const { t } = useTranslation()
  const { object, isCentre, hiddenReferenced = 0, hiddenReferencing = 0 } = data
  const Icon = KIND_ICON[object.kind]
  return (
    <div className="relative">
      {/* Vertical stubs for off-map related tables: above for tables this references,
          below for tables that reference it. Kept clear of the horizontal edges. */}
      {hiddenReferenced > 0 && (
        <HiddenStub
          side="top"
          count={hiddenReferenced}
          label={t('schema.hiddenReferenced', { count: hiddenReferenced })}
        />
      )}
      {hiddenReferencing > 0 && (
        <HiddenStub
          side="bottom"
          count={hiddenReferencing}
          label={t('schema.hiddenReferencing', { count: hiddenReferencing })}
        />
      )}
      <div
        className={cn(
          'w-60 overflow-hidden rounded-md border bg-card shadow-sm transition-shadow',
          isCentre
            ? 'ring-2 ring-brand ring-offset-1'
            : 'cursor-pointer hover:border-brand/50 hover:shadow-md',
        )}
      >
        <Handle type="target" position={Position.Left} className="!size-2 !bg-brand" />
      <div className="flex items-center gap-1.5 border-b border-brand/25 bg-brand/15 px-2.5 py-2">
        <Icon className="size-3.5 shrink-0 text-brand" />
        <span className="truncate text-sm font-medium" title={object.name}>
          {object.name}
        </span>
      </div>
      <ul className="py-1">
        {object.columns.map((column) => (
          <li
            key={column.name}
            className="flex items-center gap-2 px-2.5 py-0.5 text-xs leading-[18px]"
          >
            {column.is_primary_key ? (
              <KeyRound className="size-3 shrink-0 text-brand" />
            ) : (
              <span className="size-3 shrink-0" aria-hidden />
            )}
            <span className="truncate" title={column.name}>
              {column.name}
            </span>
            <span className="ml-auto truncate text-muted-foreground" title={column.data_type}>
              {column.data_type}
            </span>
          </li>
        ))}
      </ul>
        <Handle type="source" position={Position.Right} className="!size-2 !bg-brand" />
      </div>
    </div>
  )
}
