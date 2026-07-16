import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KindBadge } from '@/components/kind-badge'
import {
  type CellValue,
  fetchRows,
  type FilterOperator,
  type RowFilter,
  type RowPage,
  type RowSort,
  type SchemaObject,
} from '@/lib/api'
import { cn } from '@/lib/utils'

/** Rows fetched per page — matches the backend's default and keeps a preview bounded. */
const PAGE_SIZE = 100

/** The filter operators, in the order they appear in the picker. */
const OPERATORS: FilterOperator[] = ['contains', 'eq', 'ne', 'is_null', 'is_not_null']

/** Operators that test the column alone, so their value input is hidden. */
const VALUELESS: FilterOperator[] = ['is_null', 'is_not_null']

type Status = 'idle' | 'loading' | 'error'

interface DataDrawerProps {
  /** The connected profile, whose database holds the object. */
  profileId: string
  /** The object to preview — the map's current centre; `null` before one is chosen. */
  object: SchemaObject | null
  /** Whether the drawer is showing. */
  open: boolean
  /** Close the drawer. */
  onClose: () => void
}

/** Render one cell: NULL reads apart from an empty string, booleans as words. */
function Cell({ value, nullLabel }: { value: CellValue; nullLabel: string }) {
  if (value === null) {
    return <span className="italic text-muted-foreground/40">{nullLabel}</span>
  }
  if (typeof value === 'boolean') {
    return <>{value ? 'true' : 'false'}</>
  }
  return <>{String(value)}</>
}

/**
 * A bottom drawer showing a page of the centre object's rows: a scrollable grid with
 * click-to-sort headers and an AND-combined set of column filters, paged in blocks of
 * {@link PAGE_SIZE}. Follows the map — as the centre travels, the drawer re-reads and its
 * sort and filters reset to suit the new object. Reads are strictly read-only (see the
 * backend); values are shown as text, binary as a size placeholder.
 */
export function DataDrawer({ profileId, object, open, onClose }: DataDrawerProps) {
  const { t } = useTranslation()
  const [sort, setSort] = useState<RowSort | null>(null)
  const [filters, setFilters] = useState<RowFilter[]>([])
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<RowPage | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  const objectId = object?.id ?? null

  // A new centre is a new table: drop the previous sort, filters and page so they never
  // carry over to columns that do not exist on it.
  useEffect(() => {
    setSort(null)
    setFilters([])
    setOffset(0)
    setPage(null)
    setStatus('idle')
  }, [objectId])

  // Only filters with a column chosen are sent (a half-built row is ignored).
  const activeFilters = useMemo(() => filters.filter((filter) => filter.column !== ''), [filters])

  // Read the page whenever the drawer is open and the query changes. A short debounce
  // keeps typing in a filter value from firing a request per keystroke.
  useEffect(() => {
    if (!open || object === null) {
      return
    }
    let cancelled = false
    const handle = window.setTimeout(() => {
      setStatus('loading')
      fetchRows(profileId, object.id, { limit: PAGE_SIZE, offset, sort, filters: activeFilters })
        .then((result) => {
          if (!cancelled) {
            setPage(result)
            setStatus('idle')
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : String(cause))
            setStatus('error')
          }
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [open, object, profileId, offset, sort, activeFilters])

  if (!open) {
    return null
  }

  // Clicking a header cycles ascending → descending → unsorted, and returns to the first
  // page since the ordering changed underneath.
  function cycleSort(column: string): void {
    setOffset(0)
    setSort((current) => {
      if (current === null || current.column !== column) {
        return { column, direction: 'asc' }
      }
      return current.direction === 'asc' ? { column, direction: 'desc' } : null
    })
  }

  function addFilter(): void {
    const firstColumn = object?.columns[0]?.name ?? ''
    setFilters((current) => [...current, { column: firstColumn, operator: 'contains', value: '' }])
  }

  function updateFilter(index: number, patch: Partial<RowFilter>): void {
    setOffset(0)
    setFilters((current) =>
      current.map((filter, position) => (position === index ? { ...filter, ...patch } : filter)),
    )
  }

  function removeFilter(index: number): void {
    setOffset(0)
    setFilters((current) => current.filter((_, position) => position !== index))
  }

  const rowCount = page?.rows.length ?? 0
  const canPrevious = offset > 0 && status !== 'loading'
  const canNext = (page?.has_more ?? false) && status !== 'loading'

  return (
    <div className="flex h-[32vh] max-h-[44vh] min-h-40 shrink-0 flex-col border-t border-brand/25 bg-card shadow-[0_-6px_20px_-10px_rgba(0,0,0,0.18)]">
      {/* Header: which object, the current row range, paging and close. */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-brand/20 bg-brand/10 px-3 text-xs">
        <span className="font-medium text-foreground">{object?.name ?? t('data.title')}</span>
        {object && <KindBadge kind={object.kind} />}
        {status === 'loading' && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        <div className="ml-auto flex items-center gap-1">
          {rowCount > 0 && (
            <span className="mr-1 text-muted-foreground tabular-nums">
              {t('data.range', { from: offset + 1, to: offset + rowCount })}
            </span>
          )}
          <button
            type="button"
            onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
            disabled={!canPrevious}
            aria-label={t('data.previous')}
            title={t('data.previous')}
            className="rounded p-1 hover:bg-brand/15 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setOffset((current) => current + PAGE_SIZE)}
            disabled={!canNext}
            aria-label={t('data.next')}
            title={t('data.next')}
            className="rounded p-1 hover:bg-brand/15 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-4" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('data.close')}
            title={t('data.close')}
            className="rounded p-1 hover:bg-brand/15"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Filter bar: AND-combined column conditions, each removable. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-brand/15 bg-brand/[0.04] px-3 py-1.5">
        {filters.map((filter, index) => (
          <div
            // Filters have no stable id; their position is their identity here.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            className="flex items-center gap-1 rounded-md border border-brand/20 bg-background py-0.5 pl-1.5 pr-1 text-xs"
          >
            <select
              value={filter.column}
              onChange={(event) => updateFilter(index, { column: event.target.value })}
              aria-label={t('data.filterColumn')}
              className="max-w-28 bg-transparent font-medium outline-none"
            >
              {object?.columns.map((column) => (
                <option key={column.name} value={column.name}>
                  {column.name}
                </option>
              ))}
            </select>
            <select
              value={filter.operator}
              onChange={(event) =>
                updateFilter(index, { operator: event.target.value as FilterOperator })
              }
              aria-label={t('data.operator.contains')}
              className="bg-transparent text-muted-foreground outline-none"
            >
              {OPERATORS.map((operator) => (
                <option key={operator} value={operator}>
                  {t(`data.operator.${operator}`)}
                </option>
              ))}
            </select>
            {!VALUELESS.includes(filter.operator) && (
              <input
                value={filter.value ?? ''}
                onChange={(event) => updateFilter(index, { value: event.target.value })}
                placeholder={t('data.filterValue')}
                className="w-24 bg-transparent outline-none placeholder:text-muted-foreground/50"
              />
            )}
            <button
              type="button"
              onClick={() => removeFilter(index)}
              aria-label={t('data.removeFilter')}
              className="rounded p-0.5 text-muted-foreground hover:bg-brand/15 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addFilter}
          className="flex items-center gap-1 rounded-md border border-dashed border-brand/30 px-1.5 py-1 text-xs text-muted-foreground hover:border-brand/50 hover:text-foreground"
        >
          <Plus className="size-3" />
          {t('data.addFilter')}
        </button>
      </div>

      {/* Body: the grid, or a loading / error / empty state. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {status === 'error' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs">
            <p className="text-destructive">{error || t('data.error')}</p>
          </div>
        ) : page === null ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('data.loading')}
          </div>
        ) : page.rows.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
            {t('data.empty')}
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-secondary">
              <tr>
                {page.columns.map((column) => (
                  <th
                    key={column}
                    onClick={() => cycleSort(column)}
                    title={
                      sort?.column === column
                        ? sort.direction === 'asc'
                          ? t('data.sortAsc')
                          : t('data.sortDesc')
                        : t('data.sortNone')
                    }
                    className="cursor-pointer select-none whitespace-nowrap border-b border-border px-2.5 py-1.5 text-left font-semibold text-foreground hover:bg-brand/15"
                  >
                    <span className="inline-flex items-center gap-1">
                      {column}
                      {sort?.column === column &&
                        (sort.direction === 'asc' ? (
                          <ArrowUp className="size-3 text-brand" />
                        ) : (
                          <ArrowDown className="size-3 text-brand" />
                        ))}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row, rowIndex) => (
                <tr
                  // Rows have no key of their own; their position in the page identifies them.
                  // eslint-disable-next-line react/no-array-index-key
                  key={rowIndex}
                  className={cn(
                    'hover:bg-brand/10',
                    rowIndex % 2 === 1 ? 'bg-muted/60' : 'bg-card',
                  )}
                >
                  {row.map((value, columnIndex) => (
                    <td
                      key={page.columns[columnIndex]}
                      title={value === null ? undefined : String(value)}
                      className="max-w-96 truncate whitespace-nowrap border-b border-border/60 px-2.5 py-1"
                    >
                      <Cell value={value} nullLabel={t('data.null')} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
