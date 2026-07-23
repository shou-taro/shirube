import { Handle, type NodeProps, Position } from '@xyflow/react'
import { ArrowRight, KeyRound, Table2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KindBadge } from '@/components/kind-badge'
import type { SchemaObject } from '@/lib/api'
import { cn } from '@/lib/utils'

import type { TableFlowNode } from './layout'

/**
 * A stub marking related tables off the map, drawn vertically so it stays clear of the
 * horizontal foreign-key edges: above the node for tables it references, below for tables
 * that reference it. A short line and a table-icon count — and the count is a button that
 * opens the full list of those off-map tables, each one clickable to travel there. So a
 * hub table can be capped to a readable few neighbours without losing the rest: they are
 * one click away here (and always listed in the detail card).
 */
function HiddenStub({
  side,
  tables,
  label,
  onTravel,
}: {
  side: 'top' | 'bottom'
  tables: SchemaObject[]
  label: string
  onTravel?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close the list when the pointer goes down anywhere outside this stub.
  useEffect(() => {
    if (!open) {
      return
    }
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const line = <span className="h-3 w-0.5 bg-brand" aria-hidden />
  // A solid triangle points at the referenced table, matching the edge markers: for a
  // top stub that is the off-map table above; for a bottom stub it is this node, above.
  const arrow = (
    <svg viewBox="0 0 12 8" className="h-2 w-3 fill-brand" aria-hidden="true">
      <path d="M6 0 L12 8 L0 8 Z" />
    </svg>
  )
  // stopPropagation keeps a click on the stub from also travelling to the node it sits on.
  const chip = (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        setOpen((value) => !value)
      }}
      aria-label={label}
      aria-expanded={open}
      className="nopan flex items-center gap-0.5 rounded-full border border-brand/50 bg-card px-1.5 py-0.5 text-[10px] font-semibold text-brand shadow-sm hover:border-brand hover:bg-brand/10"
    >
      <Table2 className="size-2.5 shrink-0" aria-hidden />
      {tables.length}
    </button>
  )
  const popover = open && (
    <div
      className={cn(
        'nowheel absolute left-1/2 z-50 max-h-48 w-56 -translate-x-1/2 overflow-y-auto rounded-md border bg-card py-1 text-left shadow-lg',
        side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <p className="px-2.5 py-1 text-[10px] text-muted-foreground">{label}</p>
      <ul>
        {tables.map((table) => (
          <li key={table.id}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                // Close before travelling: this node may persist as a neighbour of the new
                // centre, and a lingering open list would be confusing.
                setOpen(false)
                onTravel?.(table.id)
              }}
              className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-xs hover:bg-brand/10"
            >
              <Table2 className="size-3 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={table.name}>
                {table.name}
              </span>
              <KindBadge kind={table.kind} />
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <div
      ref={ref}
      className={cn(
        'absolute left-1/2 flex -translate-x-1/2 flex-col items-center',
        side === 'top' ? 'bottom-full' : 'top-full',
      )}
    >
      {side === 'top' ? (
        <>
          {popover}
          {arrow}
          {chip}
          {line}
        </>
      ) : (
        <>
          {line}
          {chip}
          {arrow}
          {popover}
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
  const { object, isCentre, hiddenReferenced = [], hiddenReferencing = [], onTravel } = data
  return (
    <div className="relative">
      {/* Vertical stubs for off-map related tables: above for tables this references,
          below for tables that reference it. Kept clear of the horizontal edges, and each
          opens the full list of those tables to travel to. */}
      {hiddenReferenced.length > 0 && (
        <HiddenStub
          side="top"
          tables={hiddenReferenced}
          label={t('schema.hiddenReferenced', { count: hiddenReferenced.length })}
          onTravel={onTravel}
        />
      )}
      {hiddenReferencing.length > 0 && (
        <HiddenStub
          side="bottom"
          tables={hiddenReferencing}
          label={t('schema.hiddenReferencing', { count: hiddenReferencing.length })}
          onTravel={onTravel}
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
          <Table2 className="size-3.5 shrink-0 text-brand" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={object.name}>
            {object.name}
          </span>
          <KindBadge kind={object.kind} />
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
