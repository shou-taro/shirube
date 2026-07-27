import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, KeyRound, Link2, Trash2 } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KindBadge } from '@/components/kind-badge'
import type { ObjectKind, Relationship, SchemaGraph, SchemaObject } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Which sections of the panel are open; columns start open, relationships collapsed. */
interface OpenSections {
  columns: boolean
  references: boolean
  referencedBy: boolean
  partitions: boolean
}

/**
 * A collapsible section: a heading with a disclosure chevron and an item count, above its
 * content when open. Lets the panel show only the parts a table calls for — many columns,
 * many relationships — without one crowding out the other.
 */
function Section({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <span>{label}</span>
        <span className="ml-auto pr-1 font-normal text-muted-foreground/70">{count}</span>
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}

/**
 * A related table as a clickable row: an arrow showing the direction, the other table's
 * name, and the local columns that join them. Clicking travels the map there. A manual
 * relationship (one the user drew) is tagged and carries a remove control, revealed on hover.
 */
function RelatedRow({
  direction,
  name,
  kind,
  columns,
  dependency = false,
  manual = false,
  onNavigate,
  onRemove,
}: {
  direction: 'out' | 'in'
  name: string
  /** The related object's kind, so views read apart from tables at a glance. */
  kind: ObjectKind
  columns: string[]
  /** A view dependency rather than a foreign key: dimmed arrow, no columns. */
  dependency?: boolean
  /** A relationship the user drew rather than one read from the database. */
  manual?: boolean
  onNavigate: () => void
  /** Remove a manual relationship; present only when ``manual`` is true. */
  onRemove?: () => void
}) {
  const { t } = useTranslation()
  const Arrow = direction === 'out' ? ArrowRight : ArrowLeft
  return (
    <li className="group relative flex items-center hover:bg-brand/10">
      <button
        type="button"
        onClick={onNavigate}
        className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs leading-[18px]"
      >
        <Arrow className={cn('size-3 shrink-0', dependency ? 'text-muted-foreground' : 'text-brand')} />
        <span className="min-w-0 truncate font-medium" title={name}>
          {name}
        </span>
        <KindBadge kind={kind} />
        {manual && (
          <span className="shrink-0 rounded-sm border border-brand/30 bg-card px-1 text-[9px] font-semibold uppercase tracking-wide text-brand">
            {t('relationships.manual')}
          </span>
        )}
        {/* On a manual row the joined columns slide left on hover to clear the remove
            control, so it never overlaps them. */}
        <span
          className={cn(
            'ml-auto truncate text-[11px] text-muted-foreground',
            manual && 'transition-[margin] group-hover:mr-7',
          )}
          title={columns.join(', ')}
        >
          {columns.join(', ')}
        </span>
      </button>
      {manual && onRemove && (
        <button
          type="button"
          aria-label={t('relationships.remove')}
          title={t('relationships.remove')}
          onClick={onRemove}
          className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="size-3" />
        </button>
      )}
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
  /** Begin drawing a manual relationship from one of this table's columns. */
  onStartLink: (sourceColumn: string) => void
  /** Remove a manual relationship the user drew, by its id. */
  onRemoveRelationship: (relationshipId: string) => void
}

/**
 * The detail of the map's centre table: its columns, then its foreign-key relationships
 * split by direction — tables it references, and tables that reference it. Each section
 * collapses independently (columns open by default), and each related table is clickable
 * to travel there. Fills the floating card in the workspace's top-left; the card owns the
 * table's name (in its header) and scrolling.
 */
export function TableDetail({
  object,
  graph,
  onNavigate,
  onStartLink,
  onRemoveRelationship,
}: TableDetailProps) {
  const { t } = useTranslation()
  // Open state persists as the centre changes, so a section opened for exploring — say
  // "referenced by" — stays open while travelling from table to table.
  const [openSections, setOpenSections] = useState<OpenSections>({
    columns: true,
    references: false,
    referencedBy: false,
    partitions: false,
  })

  function toggle(section: keyof OpenSections): void {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }))
  }

  // Objects by id, for labelling the related rows with their name and kind.
  const objectById = useMemo(() => {
    const map = new Map<string, SchemaObject>()
    for (const candidate of graph.objects) {
      map.set(candidate.id, candidate)
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
    <div className="pb-2">
      <Section
        label={t('schema.columns')}
        count={object.columns.length}
        open={openSections.columns}
        onToggle={() => toggle('columns')}
      >
        <ul>
          {object.columns.map((column) => (
            <li
              key={column.name}
              className="group relative flex items-center gap-2 px-3 py-1 text-xs leading-[18px]"
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
              {/* The type slides left on hover so the link button reveals in the freed
                  space rather than overlapping it. */}
              <span
                className="ml-auto truncate text-muted-foreground transition-[margin] group-hover:mr-7"
                title={column.data_type}
              >
                {column.data_type}
              </span>
              {/* Draw a relationship from this column. Absolutely positioned so it reserves
                  no space — the type sits flush at rest — and reveals on hover (or keyboard
                  focus) in the gap the type opens up. */}
              <button
                type="button"
                aria-label={t('relationships.linkColumn', { column: column.name })}
                title={t('relationships.linkColumn', { column: column.name })}
                onClick={() => onStartLink(column.name)}
                className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:bg-brand/15 hover:text-brand focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Link2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {references.length > 0 && (
        <Section
          label={t('schema.references')}
          count={references.length}
          open={openSections.references}
          onToggle={() => toggle('references')}
        >
          <ul>
            {references.map((relationship) => (
              <RelatedRow
                key={relationship.constraint_name}
                direction="out"
                name={objectById.get(relationship.target)?.name ?? relationship.target}
                kind={objectById.get(relationship.target)?.kind ?? 'table'}
                columns={relationship.source_columns}
                dependency={relationship.kind === 'view_dependency'}
                manual={relationship.kind === 'manual'}
                onNavigate={() => onNavigate(relationship.target)}
                onRemove={
                  relationship.id
                    ? () => onRemoveRelationship(relationship.id as string)
                    : undefined
                }
              />
            ))}
          </ul>
        </Section>
      )}

      {referencedBy.length > 0 && (
        <Section
          label={t('schema.referencedBy')}
          count={referencedBy.length}
          open={openSections.referencedBy}
          onToggle={() => toggle('referencedBy')}
        >
          <ul>
            {referencedBy.map((relationship) => (
              <RelatedRow
                key={relationship.constraint_name}
                direction="in"
                name={objectById.get(relationship.source)?.name ?? relationship.source}
                kind={objectById.get(relationship.source)?.kind ?? 'table'}
                columns={relationship.target_columns}
                dependency={relationship.kind === 'view_dependency'}
                manual={relationship.kind === 'manual'}
                onNavigate={() => onNavigate(relationship.source)}
                onRemove={
                  relationship.id
                    ? () => onRemoveRelationship(relationship.id as string)
                    : undefined
                }
              />
            ))}
          </ul>
        </Section>
      )}

      {object.partitions.length > 0 && (
        <Section
          label={t('schema.partitions')}
          count={object.partitions.length}
          open={openSections.partitions}
          onToggle={() => toggle('partitions')}
        >
          <ul>
            {object.partitions.map((partition) => (
              // Name and bound stack, so the name — whose distinguishing suffix would be
              // truncated away beside a long bound — stays readable, with the range beneath.
              <li key={partition.name} className="px-3 py-1 text-xs leading-[18px]">
                <div className="truncate" title={partition.name}>
                  {partition.name}
                </div>
                {partition.bound !== null && (
                  <div
                    className="truncate font-mono text-[11px] text-muted-foreground"
                    title={partition.bound}
                  >
                    {partition.bound}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
