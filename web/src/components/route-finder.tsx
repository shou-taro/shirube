import { ArrowDown, Route, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KindBadge } from '@/components/kind-badge'
import type { Relationship, SchemaGraph, SchemaObject } from '@/lib/api'
import { findPath } from '@/lib/find-path'
import { findMatches } from '@/lib/schema-search'
import { cn } from '@/lib/utils'

// How long the panel's exit animation runs; the panel is kept mounted this long after a
// dismiss so `shirube-menu-out` can play before the parent unmounts it. Must match the
// duration in the panel's className below (keep the two in step).
const MENU_EXIT_MS = 120

/** The joined columns as `a, b` — or `a → b` when the two sides use different names. */
function describeJoin(aColumns: string[], bColumns: string[]): string {
  const a = aColumns.join(', ')
  const b = bColumns.join(', ')
  if (a === '' && b === '') {
    return ''
  }
  return a === b ? a : `${a} → ${b}`
}

/**
 * The columns that join two adjacent tables on the route, oriented `a → b` in route order
 * (the relationship itself may point either way). Empty for a view dependency, which joins
 * on no columns.
 */
function joinLabel(relationships: Relationship[], aId: string, bId: string): string {
  for (const rel of relationships) {
    if (rel.source === aId && rel.target === bId) {
      return describeJoin(rel.source_columns, rel.target_columns)
    }
    if (rel.source === bId && rel.target === aId) {
      return describeJoin(rel.target_columns, rel.source_columns)
    }
  }
  return ''
}

/**
 * A combobox for choosing one endpoint of the route: type to search the schema (reusing the
 * ⌘K ranking), then pick a table. The committed selection shows as the field's text; while
 * the field is focused the text is the live query, and it reverts to the selection on blur.
 * `exclude` drops one object from the results — the other endpoint, so a route can't have
 * the same table at both ends.
 */
function TableCombobox({
  listboxId,
  label,
  value,
  objects,
  exclude,
  onSelect,
  autoFocus = false,
}: {
  listboxId: string
  label: string
  value: SchemaObject | null
  objects: SchemaObject[]
  exclude: string | null
  onSelect: (object: SchemaObject) => void
  autoFocus?: boolean
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState(value?.name ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const focusedRef = useRef(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // When the committed value changes from outside (the default source, say) and the field is
  // not being edited, show that value's name.
  useEffect(() => {
    if (!focusedRef.current) {
      setQuery(value?.name ?? '')
    }
  }, [value])

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus()
    }
  }, [autoFocus])

  const matches = useMemo(
    () => findMatches(objects, query).filter((match) => match.object.id !== exclude),
    [objects, query, exclude],
  )

  const optionId = (objectId: string): string => `${listboxId}-option-${objectId}`

  function choose(object: SchemaObject): void {
    onSelect(object)
    setQuery(object.name)
    setActive(0)
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      // Escape closes the results first; only once they are shut does it bubble to the
      // finder (which closes on it). So a first press tidies the field, a second dismisses.
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
    <div className="relative flex items-center gap-2">
      <span className="w-9 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex h-8 flex-1 items-center gap-2 rounded-md border bg-background px-2.5 text-sm focus-within:ring-2 focus-within:ring-brand">
        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={t('route.searchPlaceholder')}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showResults}
          aria-activedescendant={
            showResults ? optionId((matches[active] ?? matches[0]).object.id) : undefined
          }
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => {
            focusedRef.current = true
            setOpen(true)
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => {
              focusedRef.current = false
              setOpen(false)
              // Drop an unconfirmed edit — the field shows the committed selection.
              setQuery(value?.name ?? '')
            }, 120)
          }}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </div>

      {showResults && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label}
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
  )
}

interface RouteFinderProps {
  /** The table the finder opens on — the map's current centre — used as the default source. */
  initialSource: SchemaObject
  /** Every object, for the endpoint searches and for labelling each hop. */
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

/**
 * Find a route between two tables — without the AI navigator.
 *
 * Both endpoints are chosen here: the source defaults to the table the finder was opened
 * from, and either end can be searched and changed. The shortest chain of relationships
 * between them is drawn as a list of clickable hops; clicking a hop travels the map there,
 * and the finder stays open so the whole route can be walked one table at a time. It is a
 * floating panel, not a modal, so the map stays visible behind it as you go.
 *
 * The walk is the same breadth-first search the AI navigator's `find_path` tool runs, done
 * here in the browser over the already-loaded graph (see {@link findPath}) — so it needs no
 * model and no round-trip, and links the user drew count just like foreign keys.
 */
export function RouteFinder({
  initialSource,
  objects,
  graph,
  activeId,
  onNavigate,
  onClose,
}: RouteFinderProps) {
  const { t } = useTranslation()
  const [source, setSource] = useState<SchemaObject>(initialSource)
  const [target, setTarget] = useState<SchemaObject | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // The panel eases out on dismiss. `closing` swaps the entrance animation for the exit one;
  // the parent is only told to unmount (`onClose`) once that exit has played, so the panel
  // fades out with `shirube-menu-out` rather than vanishing the instant it is dismissed.
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Dismiss with the exit animation: swap to `shirube-menu-out`, then unmount via `onClose`
  // once it has played. Idempotent — a second trigger during the animation (Escape after an
  // outside click, say) is ignored so it does not stack timers.
  const beginClose = useCallback(() => {
    if (closingRef.current) {
      return
    }
    closingRef.current = true
    setClosing(true)
    closeTimer.current = setTimeout(onClose, MENU_EXIT_MS)
  }, [onClose])

  // Clear a pending unmount timer if the panel is torn down first (a schema reload that drops
  // the source, say), so it never fires against an unmounted parent.
  useEffect(() => {
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current)
      }
    }
  }, [])

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

  // Dismiss on Escape or a click outside the panel, like the app's other floating surfaces.
  // The combobox results and the hop boxes are inside the panel, so interacting with them
  // never counts as an outside click.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        beginClose()
      }
    }
    function onPointerDown(event: MouseEvent): void {
      if (panelRef.current !== null && !panelRef.current.contains(event.target as Node)) {
        beginClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    // Capture phase: the ER map (React Flow) stops mouse events from bubbling up for its own
    // panning, so a bubble-phase listener never sees a click on the canvas. Capturing runs
    // before those handlers, so a click anywhere outside the panel still dismisses it.
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [beginClose])

  return (
    <div className="absolute left-1/2 top-4 z-40 w-[30rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2">
      <div
        ref={panelRef}
        className={cn(
          'flex max-h-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-brand/30 bg-popover text-popover-foreground shadow-xl origin-top',
          closing
            ? 'animate-[shirube-menu-out_120ms_ease-in_forwards]'
            : 'animate-[shirube-menu-in_140ms_ease-out]',
        )}
      >
        {/* Header. */}
        <div className="flex items-center gap-1.5 border-b border-brand/20 bg-brand/10 px-3 py-2 text-sm font-medium">
          <Route className="size-4 shrink-0 text-brand" aria-hidden="true" />
          <span>{t('route.title')}</span>
          <button
            type="button"
            aria-label={t('route.close')}
            onClick={beginClose}
            className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-brand/15 hover:text-brand"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* From and To — both searchable; the source starts at the current centre. */}
        <div className="space-y-2 border-b border-brand/20 px-3 py-2.5">
          <TableCombobox
            listboxId="route-from-listbox"
            label={t('route.from')}
            value={source}
            objects={objects}
            exclude={target?.id ?? null}
            onSelect={setSource}
          />
          <TableCombobox
            listboxId="route-to-listbox"
            label={t('route.to')}
            value={target}
            objects={objects}
            exclude={source.id}
            onSelect={setTarget}
            autoFocus
          />
        </div>

        {/* The result: the hop list, or a hint / no-route message. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 text-sm">
          {target === null ? (
            <p className="text-xs text-muted-foreground">{t('route.hint')}</p>
          ) : hops === null || hops.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('route.noRoute')}</p>
          ) : (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                {t('route.found', { count: hops.length - 1 })}
              </p>
              {/* The route as a small diagram: a table box per hop, joined by connectors
                  that name the columns the two tables meet on. Each box travels the map. */}
              <ol className="space-y-0">
                {hops.map((id, index) => {
                  const object = objectById.get(id)
                  const isActive = id === activeId
                  const join =
                    index < hops.length - 1
                      ? joinLabel(graph.relationships, id, hops[index + 1])
                      : null
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => onNavigate(id)}
                        aria-current={isActive ? 'true' : undefined}
                        title={t('route.showOnMap', { name: object?.name ?? id })}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-brand/10',
                          isActive ? 'border-brand bg-brand/15' : 'border-brand/20 bg-card',
                        )}
                      >
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-sm',
                            isActive && 'font-medium text-brand',
                          )}
                          title={object?.name ?? id}
                        >
                          {object?.name ?? id}
                        </span>
                        {object && <KindBadge kind={object.kind} />}
                      </button>
                      {join !== null && (
                        <div className="flex items-center gap-1.5 py-1 pl-4 text-[11px] text-muted-foreground">
                          <ArrowDown className="size-3 shrink-0" aria-hidden="true" />
                          <span
                            className="min-w-0 truncate font-mono"
                            title={join === '' ? t('route.viaView') : join}
                          >
                            {join === '' ? t('route.viaView') : join}
                          </span>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
