import type { SchemaObject } from '@/lib/api'

/** The default number of matches returned, mirroring the backend look-up's limit. */
export const MAX_RESULTS = 8

/** A single search hit: the object to centre on, and why it matched. */
export interface Match {
  object: SchemaObject
  /** The matching column name, when the hit came from a column rather than the name. */
  column?: string
}

/**
 * Relevance rank of an object name against the query: lower is better, `null` if the name
 * doesn't match at all. An exact name beats a prefix, which beats a mere substring — so
 * searching "store" surfaces the `store` table above `sales_by_store`.
 *
 * @param name - The object name to score.
 * @param query - The already lower-cased, trimmed query.
 */
export function nameRank(name: string, query: string): number | null {
  const n = name.toLowerCase()
  if (n === query) return 0 // exact
  if (n.startsWith(query)) return 1 // prefix
  if (n.includes(query)) return 2 // substring
  return null
}

/**
 * Find objects matching the query: by object name first (ranked exact → prefix →
 * substring), then by column name (so "where does customer_id live?" leads somewhere).
 * Every name match ranks above every column match, and each object appears once. Mirrors
 * the backend `SchemaLookup.search_objects` so the two surfaces order hits identically.
 *
 * @param objects - The objects to search.
 * @param query - The search text; leading/trailing space is ignored and matching is
 *   case-insensitive. An empty query returns no hits.
 * @param limit - The maximum number of hits to return.
 * @returns Up to `limit` ranked hits, best first.
 */
export function findMatches(
  objects: SchemaObject[],
  query: string,
  limit: number = MAX_RESULTS,
): Match[] {
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
  return ranked.slice(0, limit).map((entry) => entry.match)
}
