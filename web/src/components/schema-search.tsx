import { Eye, Layers, Search, Table2 } from 'lucide-react'
import type { ComponentType } from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ObjectKind, SchemaObject } from '@/lib/api'
import { cn } from '@/lib/utils'

const KIND_ICON: Record<ObjectKind, ComponentType<{ className?: string }>> = {
  table: Table2,
  view: Eye,
  materialized_view: Layers,
}

const MAX_RESULTS = 8

/** A single search hit: the object to centre on, and why it matched. */
interface Match {
  object: SchemaObject
  /** The matching column name, when the hit came from a column rather than the name. */
  column?: string
}

/**
 * Find objects matching the query: first by object name, then by column name (so
 * "where does customer_id live?" leads somewhere). Name matches rank above column
 * matches, and each object appears once.
 */
function findMatches(objects: SchemaObject[], query: string): Match[] {
  const q = query.trim().toLowerCase()
  if (q === '') {
    return []
  }
  const nameHits: Match[] = []
  const columnHits: Match[] = []
  const seen = new Set<string>()
  for (const object of objects) {
    if (object.name.toLowerCase().includes(q)) {
      nameHits.push({ object })
      seen.add(object.id)
    }
  }
  for (const object of objects) {
    if (seen.has(object.id)) {
      continue
    }
    const column = object.columns.find((c) => c.name.toLowerCase().includes(q))
    if (column) {
      columnHits.push({ object, column: column.name })
      seen.add(object.id)
    }
  }
  return [...nameHits, ...columnHits].slice(0, MAX_RESULTS)
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

  const matches = useMemo(() => findMatches(objects, query), [objects, query])

  function choose(match: Match): void {
    onSelect(match.object.id)
    setQuery('')
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setOpen(false)
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
          type="text"
          value={query}
          placeholder={t('search.placeholder')}
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
      </div>

      {showResults && (
        <ul
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
            matches.map((match, index) => {
              const Icon = KIND_ICON[match.object.kind]
              return (
                <li key={match.object.id}>
                  <button
                    type="button"
                    onClick={() => choose(match)}
                    onMouseEnter={() => setActive(index)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm',
                      index === active && 'bg-brand/10',
                    )}
                  >
                    <Icon className="size-3.5 shrink-0 text-brand" />
                    <span className="truncate font-medium">{match.object.name}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {match.column ? t('search.inColumn', { column: match.column }) : match.object.schema}
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
