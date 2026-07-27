import { ChevronDown, ChevronRight, Folder, KeyRound, Link2, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KindBadge } from '@/components/kind-badge'
import { KindIcon } from '@/components/kind-icon'
import type { Relationship, SchemaObject } from '@/lib/api'
import { buildForeignKeys, groupBySchema } from '@/lib/schema-tree'

/** The column a relationship is drawn from, and where it will point. */
export interface ColumnRef {
  schema: string
  table: string
  column: string
}

/** A likely target for a `<name>_id` column: that table's primary key. */
interface Suggestion {
  object: SchemaObject
  column: string
}

/**
 * Guess the target of a foreign-key-shaped column name. `store_id` most likely points at
 * `store`'s primary key; this looks for a table named after the column's stem (with or
 * without a trailing "s") that has a single-column primary key, and suggests that key.
 * Best-effort — it never blocks picking something else.
 */
function suggestTarget(sourceColumn: string, objects: SchemaObject[]): Suggestion | null {
  const match = /^(.*?)_id$/i.exec(sourceColumn)
  if (!match || match[1] === '') {
    return null
  }
  const stem = match[1].toLowerCase()
  const candidates = new Set([stem, `${stem}s`, stem.replace(/s$/, '')])
  for (const object of objects) {
    if (!candidates.has(object.name.toLowerCase())) {
      continue
    }
    const keys = object.columns.filter((column) => column.is_primary_key)
    if (keys.length === 1) {
      return { object, column: keys[0].name }
    }
  }
  return null
}

/** Whether an object matches the filter — by its own name or any of its column names. */
function objectMatches(object: SchemaObject, query: string): boolean {
  if (object.name.toLowerCase().includes(query)) {
    return true
  }
  return object.columns.some((column) => column.name.toLowerCase().includes(query))
}

interface RelationshipTargetPickerProps {
  source: ColumnRef
  objects: SchemaObject[]
  relationships: Relationship[]
  /** Whether a create request is in flight, so the picker can show it is working. */
  busy?: boolean
  onPick: (target: ColumnRef) => void
  onClose: () => void
}

/**
 * A modal for choosing the target column of a manual relationship. It mirrors the browse
 * tree — schemas, then tables and views, expandable to their columns — but here a click on
 * a *column* selects it as the target (rather than travelling the map), a search narrows a
 * large schema, and a foreign-key-shaped source column suggests its likely target up top.
 * The source is fixed (shown in the header), so only the far end is chosen here.
 */
export function RelationshipTargetPicker({
  source,
  objects,
  relationships,
  busy = false,
  onPick,
  onClose,
}: RelationshipTargetPickerProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const foreignKeys = useMemo(
    () => buildForeignKeys(objects, relationships),
    [objects, relationships],
  )
  const suggestion = useMemo(
    () => suggestTarget(source.column, objects),
    [source.column, objects],
  )
  const query = filter.trim().toLowerCase()
  const groups = useMemo(() => {
    const grouped = groupBySchema(objects)
    if (query === '') {
      return grouped
    }
    return grouped
      .map((group) => ({
        schema: group.schema,
        objects: group.objects.filter((object) => objectMatches(object, query)),
      }))
      .filter((group) => group.objects.length > 0)
  }, [objects, query])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function toggleObject(id: string): void {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // While filtering, treat every object as expanded so matching columns are reachable.
  const objectOpen = (id: string): boolean => query !== '' || expanded.has(id)

  function renderColumn(object: SchemaObject, columnName: string, dataType: string, isPk: boolean) {
    const fkTarget = foreignKeys.get(object.id)?.get(columnName)
    return (
      <button
        key={columnName}
        type="button"
        disabled={busy}
        onClick={() =>
          onPick({ schema: object.schema, table: object.name, column: columnName })
        }
        className="flex w-full items-center gap-1.5 py-1 pl-9 pr-2 text-left text-xs hover:bg-brand/10 disabled:opacity-50"
      >
        {isPk ? (
          <KeyRound className="size-3 shrink-0 text-brand" aria-label={t('tree.primaryKey')} />
        ) : fkTarget !== undefined ? (
          <Link2
            className="size-3 shrink-0 text-muted-foreground"
            aria-label={t('tree.foreignKey', { target: fkTarget })}
          />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <span className="min-w-0 truncate">{columnName}</span>
        <span className="ml-auto shrink-0 truncate font-mono text-[11px] text-muted-foreground">
          {dataType}
        </span>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('relationships.pickerTitle')}
        className="flex max-h-[80vh] w-96 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
      >
        <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="shrink-0 text-muted-foreground">{t('relationships.linkFrom')}</span>
            <span className="truncate rounded bg-brand/15 px-1.5 py-0.5 font-mono text-xs text-brand">
              {source.table}.{source.column}
            </span>
          </span>
          <button
            type="button"
            aria-label={t('relationships.close')}
            onClick={onClose}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-brand/15 hover:text-brand"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="border-b px-3 py-2">
          <input
            type="text"
            value={filter}
            placeholder={t('relationships.filter')}
            aria-label={t('relationships.filter')}
            onChange={(event) => setFilter(event.target.value)}
            autoFocus
            className="h-8 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-brand"
          />
          <p className="mt-1.5 px-0.5 text-xs text-muted-foreground">
            {t('relationships.pickHint')}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {suggestion && query === '' && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                onPick({
                  schema: suggestion.object.schema,
                  table: suggestion.object.name,
                  column: suggestion.column,
                })
              }
              className="mb-1 flex w-full items-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 px-2 py-1.5 text-left text-xs disabled:opacity-50"
            >
              <Sparkles className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
              <span className="shrink-0 font-medium text-brand">{t('relationships.suggested')}</span>
              <span className="min-w-0 truncate font-mono">
                {suggestion.object.name}.{suggestion.column}
              </span>
            </button>
          )}

          {groups.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {t('relationships.noMatches')}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.schema}>
                <div className="flex items-center gap-1.5 px-1.5 py-1 text-sm font-medium text-muted-foreground">
                  <Folder className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">{group.schema}</span>
                </div>
                {group.objects.map((object) => (
                  <div key={object.id}>
                    <button
                      type="button"
                      aria-expanded={objectOpen(object.id)}
                      onClick={() => toggleObject(object.id)}
                      className="flex w-full items-center gap-1.5 rounded-sm py-1 pl-1.5 pr-2 text-left text-sm hover:bg-brand/10"
                    >
                      {objectOpen(object.id) ? (
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      )}
                      <KindIcon kind={object.kind} />
                      <span className="min-w-0 truncate">{object.name}</span>
                      <KindBadge kind={object.kind} />
                    </button>
                    {objectOpen(object.id) &&
                      object.columns.map((column) =>
                        renderColumn(object, column.name, column.data_type, column.is_primary_key),
                      )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
