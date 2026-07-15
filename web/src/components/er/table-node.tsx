import { Handle, type NodeProps, Position } from '@xyflow/react'
import { Eye, KeyRound, Layers, Minus, Plus, Table2 } from 'lucide-react'
import type { ComponentType } from 'react'

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
 * A schema object as a card on the ER map: a titled header with a kind icon, above the
 * list of columns. Primary-key columns are flagged, and the type sits to the right.
 * Left and right handles anchor the foreign-key edges.
 *
 * The centre of the neighbourhood is ringed for emphasis. A node with neighbours still
 * off the map carries a "+N" button to reveal them; an expanded node carries a collapse
 * button to hide them again.
 */
export function TableNode({ data }: NodeProps<TableFlowNode>) {
  const { object, isCentre, expanded, hiddenCount = 0, onToggleExpand } = data
  const Icon = KIND_ICON[object.kind]
  // The centre is always shown with its neighbours, so it needs no toggle; other nodes
  // can expand (hidden neighbours remain) or collapse (already expanded).
  const canToggle = onToggleExpand !== undefined && !isCentre && (hiddenCount > 0 || expanded)
  return (
    <div
      className={cn(
        'w-60 overflow-hidden rounded-md border bg-card shadow-sm',
        isCentre && 'ring-2 ring-brand ring-offset-1',
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !bg-brand" />
      <div className="flex items-center gap-1.5 border-b border-brand/25 bg-brand/15 px-2.5 py-2">
        <Icon className="size-3.5 shrink-0 text-brand" />
        <span className="truncate text-sm font-medium" title={object.name}>
          {object.name}
        </span>
        {canToggle && (
          <button
            type="button"
            onClick={() => onToggleExpand(object.id)}
            className="nodrag ml-auto flex shrink-0 items-center gap-0.5 rounded bg-brand-soft px-1 py-0.5 text-[11px] font-medium text-brand-foreground hover:bg-brand"
            title={expanded ? 'Collapse' : `Expand ${hiddenCount} more`}
            aria-label={expanded ? 'Collapse' : `Expand ${hiddenCount} more`}
          >
            {expanded ? (
              <Minus className="size-3" />
            ) : (
              <>
                <Plus className="size-3" />
                {hiddenCount}
              </>
            )}
          </button>
        )}
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
  )
}
