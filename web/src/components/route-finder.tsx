import { ArrowDown, MapPin, Route, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KindBadge } from '@/components/kind-badge'
import type { SchemaGraph, SchemaObject } from '@/lib/api'
import { findPath } from '@/lib/find-path'
import { findMatches } from '@/lib/schema-search'
import { cn } from '@/lib/utils'

interface RouteFinderProps {
  /** The table to route from — the map's current centre when the finder is opened. */
  source: SchemaObject
  /** Every object, for the destination search and for labelling each hop. */
  objects: SchemaObject[]
  /** The whole schema, whose relationships the route is walked over. */
  graph: SchemaGraph
  /** The map's current centre, so the hop the user is standing on is marked. */
  activeId: string | null
  /** Travel the map to a hop; the finder stays open so the route can be walked. */
  onNavigate: (id: string) => void
  /** Dismiss the finder. */
  onClose: () => void
}

const LISTBOX_ID = 'route-target-listbox'
const optionId = (objectId: string): string => `route-target-option-${objectId}`

/**
 * Find a route between two tables — without the AI navigator.
 *
 * The source is fixed to the table the finder was opened from; the user searches for a
 * destination, and the shortest chain of relationships between the two is drawn as a list
 * of clickable hops. Clicking a hop travels the map there, and the finder stays open so the
 * whole route can be walked one table at a time. It is a floating panel, not a modal, so
 * the map stays visible behind it as you go.
 *
 * The walk is the same breadth-first search the AI navigator's `find_path` tool runs, done
 * here in the browser over the already-loaded graph (see {@link findPath}) — so it needs no
 * model and no round-trip, and links the user drew count just like foreign keys.
 */
export function RouteFinder({
  source,
  objects,
  graph,
  activeId,
  onNavigate,
  onClose,
}: RouteFinderProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [target, setTarget] = useState<SchemaObject | null>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Don't offer the source itself as a destination — a route to where you already are is not
  // a route. Everything else is fair game.
  const matches = useMemo(
    () => findMatches(objects, query).filter((match) => match.object.id !== source.id),
    [objects, query, source.id],
  )

  // The shortest path once a destination is chosen: the hop ids source → target inclusive,
  // an empty array when the two are unconnected, or null before a destination is picked.
  const hops = useMemo(
    () => (target === null ? null : findPath(graph, source.id, target.id)),
    [graph, source.id, target],
  )

  const objectById = useMemo(() => {
    const map = new Map<string, SchemaObject>()
    for (const object of objects) {
      map.set(object.id, object)
    }
    return map
  }, [objects])

  // Focus the destination field on open, and close the whole finder on Escape.
  useEffect(() => {
    inputRef.current?.focus()
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function choose(object: SchemaObject): void {
    setTarget(object)
    setQuery(object.name)
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      // Let the field's own Escape close the results first; the finder closes on a second
      // press (handled by the document listener once the list is shut).
      if (open) {
        event.stopPropagation()
        setOpen(false)
      }
      return
    }
    if (matches.length === 0) {
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (i + 1) % matches.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i - 1 + matches.length) % matches.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose((matches[active] ?? matches[0]).object)
    }
  }

  const showResults = open && query.trim() !== '' && matches.length > 0

  return (
    <div className="absolute left-1/2 top-4 z-40 w-[24rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2">
      <div className="flex max-h-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-brand/30 bg-popover text-popover-foreground shadow-xl animate-[shirube-menu-in_140ms_ease-out] origin-top">
        {/* Header. */}
        <div className="flex items-center gap-1.5 border-b border-brand/20 bg-brand/10 px-3 py-2 text-sm font-medium">
          <Route className="size-4 shrink-0 text-brand" aria-hidden="true" />
          <span>{t('route.title')}</span>
          <button
            type="button"
            aria-label={t('route.close')}
            onClick={onClose}
            className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-brand/15 hover:text-brand"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* From (fixed to the current centre) and To (searched). */}
        <div className="space-y-2 border-b border-brand/20 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-9 shrink-0 text-muted-foreground">{t('route.from')}</span>
            <span className="flex min-w-0 items-center gap-1.5 rounded bg-brand/15 px-1.5 py-0.5 text-brand">
              <MapPin className="size-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate font-medium" title={source.name}>
                {source.name}
              </span>
            </span>
          </div>

          <div className="relative flex items-center gap-2">
            <span className="w-9 shrink-0 text-xs text-muted-foreground">{t('route.to')}</span>
            <div className="flex h-8 flex-1 items-center gap-2 rounded-md border bg-background px-2.5 text-sm focus-within:ring-2 focus-within:ring-brand">
              <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                placeholder={t('route.toPlaceholder')}
                role="combobox"
                aria-label={t('route.to')}
                aria-autocomplete="list"
                aria-controls={LISTBOX_ID}
                aria-expanded={showResults}
                aria-activedescendant={
                  showResults ? optionId((matches[active] ?? matches[0]).object.id) : undefined
                }
                onChange={(event) => {
                  setQuery(event.target.value)
                  setTarget(null)
                  setActive(0)
                  setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => {
                  blurTimer.current = setTimeout(() => setOpen(false), 120)
                }}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
              />
            </div>

            {showResults && (
              <ul
                id={LISTBOX_ID}
                role="listbox"
                aria-label={t('route.to')}
                className="absolute inset-x-9 top-full z-10 mt-1 max-h-56 origin-top animate-[shirube-menu-in_140ms_ease-out] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
                onMouseDown={() => {
                  if (blurTimer.current) {
                    clearTimeout(blurTimer.current)
                  }
                }}
              >
                {matches.map((match, index) => (
                  <li key={match.object.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      id={optionId(match.object.id)}
                      aria-selected={index === active}
                      onClick={() => choose(match.object)}
                      onMouseEnter={() => setActive(index)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm',
                        index === active && 'bg-brand/10',
                      )}
                    >
                      <span className="min-w-0 truncate font-medium">{match.object.name}</span>
                      <KindBadge kind={match.object.kind} />
                      <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                        {match.column
                          ? t('search.inColumn', { column: match.column })
                          : match.object.schema}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* The result: the hop list, or a hint / no-route message. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 text-sm">
          {target === null ? (
            <p className="text-xs text-muted-foreground">{t('route.hint')}</p>
          ) : hops !== null && hops.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('route.noRoute')}</p>
          ) : hops !== null && hops.length === 1 ? (
            <p className="text-xs text-muted-foreground">{t('route.sameTable')}</p>
          ) : hops !== null ? (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                {t('route.found', { count: hops.length - 1 })}
              </p>
              <ol className="space-y-0.5">
                {hops.map((id, index) => {
                  const object = objectById.get(id)
                  const isActive = id === activeId
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => onNavigate(id)}
                        aria-current={isActive ? 'true' : undefined}
                        title={t('route.showOnMap', { name: object?.name ?? id })}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-brand/10',
                          isActive && 'bg-brand/15',
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
                            isActive ? 'bg-brand text-brand-foreground' : 'bg-brand/15 text-brand',
                          )}
                        >
                          {index + 1}
                        </span>
                        <span
                          className={cn('min-w-0 truncate', isActive && 'font-medium text-brand')}
                          title={object?.name ?? id}
                        >
                          {object?.name ?? id}
                        </span>
                        {object && <KindBadge kind={object.kind} />}
                      </button>
                      {index < hops.length - 1 && (
                        <span
                          aria-hidden="true"
                          className="flex h-3 items-center pl-3.5 text-muted-foreground/60"
                        >
                          <ArrowDown className="size-3" />
                        </span>
                      )}
                    </li>
                  )
                })}
              </ol>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
