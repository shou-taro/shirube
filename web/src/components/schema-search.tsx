import { Search, Table2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KindBadge } from '@/components/kind-badge'
import type { SchemaObject } from '@/lib/api'
import { cn } from '@/lib/utils'

const MAX_RESULTS = 8

// Ids wiring the input to its results for assistive technology (ARIA combobox pattern).
const LISTBOX_ID = 'schema-search-listbox'
const optionId = (objectId: string): string => `schema-search-option-${objectId}`

// True on Apple platforms, so the shortcut binds to ⌘ there and Ctrl elsewhere. Read from
// the platform once; `navigator.platform` is legacy but still the most reliable signal.
const IS_MAC =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)

/** A single search hit: the object to centre on, and why it matched. */
interface Match {
  object: SchemaObject
  /** The matching column name, when the hit came from a column rather than the name. */
  column?: string
}

/**
 * Relevance rank of an object name against the query: lower is better, `null` if the
 * name doesn't match at all. An exact name beats a prefix, which beats a mere substring —
 * so searching "store" surfaces the `store` table above `sales_by_store`.
 */
function nameRank(name: string, query: string): number | null {
  const n = name.toLowerCase()
  if (n === query) return 0 // exact
  if (n.startsWith(query)) return 1 // prefix
  if (n.includes(query)) return 2 // substring
  return null
}

/**
 * Find objects matching the query: by object name first (ranked exact → prefix →
 * substring), then by column name (so "where does customer_id live?" leads somewhere).
 * Every name match ranks above every column match, and each object appears once.
 */
function findMatches(objects: SchemaObject[], query: string): Match[] {
  const q = query.trim().toLowerCase()
  if (q === '') {
    return []
  }
  const ranked: { match: Match; rank: number }[] = []
  const seen = new Set<string>()
  for (const object of objects) {
    const rank = nameRank(object.name, q)
    if (rank !== null) {
      ranked.push({ match: { object }, rank })
      seen.add(object.id)
    }
  }
  // Column matches sit below any name match (rank 3).
  for (const object of objects) {
    if (seen.has(object.id)) {
      continue
    }
    const column = object.columns.find((c) => c.name.toLowerCase().includes(q))
    if (column) {
      ranked.push({ match: { object, column: column.name }, rank: 3 })
      seen.add(object.id)
    }
  }
  // A stable sort keeps the backend's alphabetical order within each rank.
  ranked.sort((a, b) => a.rank - b.rank)
  return ranked.slice(0, MAX_RESULTS).map((entry) => entry.match)
}

interface SchemaSearchProps {
  objects: SchemaObject[]
  /** Centre the map on the chosen object. */
  onSelect: (id: string) => void
}

/**
 * The top-bar search: type a table or column, pick a result, and the map recentres on
 * that table. A lightweight combobox — results appear while typing and dismiss on blur,
 * Escape, or selection.
 */
export function SchemaSearch({ objects, onSelect }: SchemaSearchProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => findMatches(objects, query), [objects, query])

  // Focus the search from anywhere with the platform shortcut — ⌘K on Apple, Ctrl+K
  // elsewhere — the modern "jump to search" affordance.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const chord = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      if (chord && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function choose(match: Match): void {
    onSelect(match.object.id)
    setQuery('')
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
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
      const match = matches[active] ?? matches[0]
      choose(match)
    }
  }

  const showResults = open && query.trim() !== ''
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="flex h-8 items-center gap-2 rounded-lg border bg-background/85 px-2.5 text-sm focus-within:ring-2 focus-within:ring-brand">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={t('search.placeholder')}
          // A combobox controlling a listbox of results: expose the state and the active
          // option so a screen reader can announce them (a placeholder is not a name).
          role="combobox"
          aria-label={t('search.placeholder')}
          aria-autocomplete="list"
          aria-controls={LISTBOX_ID}
          aria-expanded={showResults}
          aria-activedescendant={
            showResults && matches.length > 0
              ? optionId((matches[active] ?? matches[0]).object.id)
              : undefined
          }
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so a click on a result registers before the list unmounts.
            blurTimer.current = setTimeout(() => setOpen(false), 120)
          }}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
        />
        {/* The shortcut hint, shown while the field is empty; hidden once typing starts. */}
        {query === '' && (
          <kbd className="pointer-events-none shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {IS_MAC ? '⌘K' : 'Ctrl K'}
          </kbd>
        )}
      </div>

      {showResults && (
        <ul
          id={LISTBOX_ID}
          role="listbox"
          aria-label={t('search.placeholder')}
          className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
          onMouseDown={() => {
            // Keep focus on the input so onBlur's timer does not fire mid-click.
            if (blurTimer.current) {
              clearTimeout(blurTimer.current)
            }
          }}
        >
          {matches.length === 0 ? (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">{t('search.noResults')}</li>
          ) : (
            matches.map((match, index) => (
              <li key={match.object.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  id={optionId(match.object.id)}
                  aria-selected={index === active}
                  onClick={() => choose(match)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm',
                    index === active && 'bg-brand/10',
                  )}
                >
                  <Table2 className="size-3.5 shrink-0 text-brand" />
                  <span className="min-w-0 truncate font-medium">{match.object.name}</span>
                  <KindBadge kind={match.object.kind} />
                  <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
                    {match.column ? t('search.inColumn', { column: match.column }) : match.object.schema}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
