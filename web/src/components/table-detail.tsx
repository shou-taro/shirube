import { ArrowLeft, ArrowRight, KeyRound } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { Relationship, SchemaGraph, SchemaObject } from '@/lib/api'

/** A section heading within the panel, e.g. above the column list. */
function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  )
}

/**
 * A related table as a clickable row: an arrow showing the direction, the other table's
 * name, and the local columns that join them. Clicking travels the map there.
 */
function RelatedRow({
  direction,
  name,
  columns,
  onNavigate,
}: {
  direction: 'out' | 'in'
  name: string
  columns: string[]
  onNavigate: () => void
}) {
  const Arrow = direction === 'out' ? ArrowRight : ArrowLeft
  return (
    <li>
      <button
        type="button"
        onClick={onNavigate}
        className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs leading-[18px] hover:bg-brand/10"
      >
        <Arrow className="size-3 shrink-0 text-brand" />
        <span className="truncate font-medium" title={name}>
          {name}
        </span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground" title={columns.join(', ')}>
          {columns.join(', ')}
        </span>
      </button>
    </li>
  )
}

interface TableDetailProps {
  /** The table to describe — the current centre of the map. */
  object: SchemaObject
  /** The whole schema, for resolving related tables by id. */
  graph: SchemaGraph
  /** Travel the map to a related table. */
  onNavigate: (id: string) => void
}

/**
 * The detail of the map's centre table: its columns, then its foreign-key relationships
 * split by direction — tables it references, and tables that reference it. Each related
 * table is clickable to travel there. Fills the floating card in the workspace's
 * top-left; the card owns both the table's name (in its header) and scrolling, so this
 * simply lays the content out top to bottom.
 */
export function TableDetail({ object, graph, onNavigate }: TableDetailProps) {
  const { t } = useTranslation()

  // A table's short name by id, for labelling the related rows.
  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const candidate of graph.objects) {
      map.set(candidate.id, candidate.name)
    }
    return map
  }, [graph.objects])

  // Outgoing foreign keys (this table references another); self-references live here too.
  // Incoming ones (another references this) exclude self-references so they show once.
  const { references, referencedBy } = useMemo(() => {
    const references: Relationship[] = []
    const referencedBy: Relationship[] = []
    for (const relationship of graph.relationships) {
      if (relationship.source === object.id) {
        references.push(relationship)
      } else if (relationship.target === object.id) {
        referencedBy.push(relationship)
      }
    }
    return { references, referencedBy }
  }, [graph.relationships, object.id])

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

      {references.length > 0 && (
        <>
          <SectionLabel>{t('schema.references')}</SectionLabel>
          <ul>
            {references.map((relationship) => (
              <RelatedRow
                key={relationship.constraint_name}
                direction="out"
                name={nameById.get(relationship.target) ?? relationship.target}
                columns={relationship.source_columns}
                onNavigate={() => onNavigate(relationship.target)}
              />
            ))}
          </ul>
        </>
      )}

      {referencedBy.length > 0 && (
        <>
          <SectionLabel>{t('schema.referencedBy')}</SectionLabel>
          <ul>
            {referencedBy.map((relationship) => (
              <RelatedRow
                key={relationship.constraint_name}
                direction="in"
                name={nameById.get(relationship.source) ?? relationship.source}
                columns={relationship.target_columns}
                onNavigate={() => onNavigate(relationship.source)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
