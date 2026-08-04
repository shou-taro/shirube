import { ChevronDown, ChevronRight, Folder, KeyRound, Link2, ListTree, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KindBadge } from '@/components/kind-badge'
import { KindIcon } from '@/components/kind-icon'
import { Button } from '@/components/ui/button'
import type { Relationship, SchemaObject } from '@/lib/api'
import { buildForeignKeys, groupBySchema } from '@/lib/schema-tree'
import { cn } from '@/lib/utils'

interface SchemaTreeProps {
  objects: SchemaObject[]
  relationships: Relationship[]
  /** The map's current centre, highlighted in the tree; null when none. */
  activeId: string | null
  /** Travel the map to the chosen object. */
  onSelect: (id: string) => void
}

/**
 * A toolbar button that opens a collapsible tree of the whole schema — schemas, then their
 * tables and views, each expandable to its columns (primary and foreign keys marked). It
 * complements the ER map (which shows one neighbourhood) and the search (which needs a
 * query) with a browse-and-jump view: click an object to travel the map there, while the
 * popover stays open so several can be visited in turn. The map's current centre is
 * highlighted so the two views stay in step.
 */
export function SchemaTree({ objects, relationships, activeId, onSelect }: SchemaTreeProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Schemas are expanded by default; this holds the ones the user has collapsed. Objects
  // are collapsed by default; this holds the ones the user has expanded.
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(() => new Set())
  const [expandedObjects, setExpandedObjects] = useState<Set<string>>(() => new Set())
  const containerRef = useRef<HTMLDivElement>(null)

  const foreignKeys = useMemo(
    () => buildForeignKeys(objects, relationships),
    [objects, relationships],
  )
  const groups = useMemo(() => groupBySchema(objects), [objects])

  // Dismiss on an outside click or Escape, like the other floating surfaces.
  useEffect(() => {
    if (!open) {
      return
    }
    function onPointerDown(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function toggleSchema(schema: string): void {
    setCollapsedSchemas((current) => {
      const next = new Set(current)
      if (next.has(schema)) {
        next.delete(schema)
      } else {
        next.add(schema)
      }
      return next
    })
  }

  function toggleObject(id: string): void {
    setExpandedObjects((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const schemaOpen = (schema: string): boolean => !collapsedSchemas.has(schema)

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('tree.open')}
        title={t('tree.open')}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'hover:bg-brand/15 hover:text-brand',
          open && 'bg-brand/15 text-brand',
        )}
      >
        <ListTree className="size-4" />
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 flex max-h-[70vh] w-80 origin-top-right animate-[shirube-menu-in_140ms_ease-out] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center justify-between border-b px-2.5 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t('tree.open')}</span>
            <button
              type="button"
              aria-label={t('tree.close')}
              onClick={() => setOpen(false)}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-brand/15 hover:text-brand"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {groups.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">{t('schema.empty')}</p>
            ) : (
              groups.map((group) => (
                <div key={group.schema}>
                  <button
                    type="button"
                    aria-expanded={schemaOpen(group.schema)}
                    onClick={() => toggleSchema(group.schema)}
                    className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-sm font-medium hover:bg-brand/10"
                  >
                    {schemaOpen(group.schema) ? (
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 truncate">{group.schema}</span>
                    <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                      {group.objects.length}
                    </span>
                  </button>

                  {schemaOpen(group.schema) &&
                    group.objects.map((object) => {
                      const hasColumns = object.columns.length > 0
                      const expanded = expandedObjects.has(object.id)
                      const active = object.id === activeId
                      const fkColumns = foreignKeys.get(object.id)
                      return (
                        <div key={object.id}>
                          <div
                            className={cn(
                              'flex items-center rounded-sm pl-1.5',
                              active && 'bg-brand/10',
                            )}
                          >
                            {hasColumns ? (
                              <button
                                type="button"
                                aria-label={expanded ? t('tree.collapse') : t('tree.expand')}
                                aria-expanded={expanded}
                                onClick={() => toggleObject(object.id)}
                                className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-brand"
                              >
                                {expanded ? (
                                  <ChevronDown className="size-3.5" aria-hidden="true" />
                                ) : (
                                  <ChevronRight className="size-3.5" aria-hidden="true" />
                                )}
                              </button>
                            ) : (
                              <span className="size-5 shrink-0" />
                            )}
                            <button
                              type="button"
                              aria-current={active ? 'true' : undefined}
                              onClick={() => onSelect(object.id)}
                              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-1 pr-1.5 text-left text-sm"
                            >
                              <KindIcon kind={object.kind} />
                              <span
                                className={cn('min-w-0 truncate', active && 'font-medium text-brand')}
                              >
                                {object.name}
                              </span>
                              <KindBadge kind={object.kind} />
                            </button>
                          </div>

                          {expanded &&
                            object.columns.map((column) => {
                              const fkTarget = fkColumns?.get(column.name)
                              return (
                                <div
                                  key={column.name}
                                  className="flex items-center gap-1.5 py-0.5 pl-9 pr-2 text-xs"
                                >
                                  {column.is_primary_key ? (
                                    <KeyRound
                                      className="size-3 shrink-0 text-brand"
                                      aria-label={t('tree.primaryKey')}
                                    />
                                  ) : fkTarget !== undefined ? (
                                    <Link2
                                      className="size-3 shrink-0 text-muted-foreground"
                                      aria-label={t('tree.foreignKey', { target: fkTarget })}
                                    />
                                  ) : (
                                    <span className="size-3 shrink-0" />
                                  )}
                                  <span className="min-w-0 truncate">{column.name}</span>
                                  <span
                                    className="ml-auto shrink-0 truncate font-mono text-[11px] text-muted-foreground"
                                    title={fkTarget !== undefined ? `${column.data_type} → ${fkTarget}` : column.data_type}
                                  >
                                    {fkTarget !== undefined ? `→ ${fkTarget}` : column.data_type}
                                  </span>
                                </div>
                              )
                            })}
                        </div>
                      )
                    })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
