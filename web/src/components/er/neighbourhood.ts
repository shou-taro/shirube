import type { SchemaGraph, SchemaObject } from '@/lib/api'

/**
 * An undirected adjacency map over the schema: each object id mapped to the set of ids
 * it is related to. Foreign keys are directed, but for neighbourhood navigation a
 * reference makes two objects neighbours in both directions. Self-references are
 * ignored (they would not add a neighbour).
 */
export type Adjacency = Map<string, Set<string>>

/** Build the undirected adjacency map for a schema graph. */
export function buildAdjacency(graph: SchemaGraph): Adjacency {
  const adjacency: Adjacency = new Map()
  const link = (from: string, to: string) => {
    const set = adjacency.get(from) ?? new Set<string>()
    set.add(to)
    adjacency.set(from, set)
  }
  for (const relationship of graph.relationships) {
    if (relationship.source === relationship.target) {
      continue
    }
    link(relationship.source, relationship.target)
    link(relationship.target, relationship.source)
  }
  return adjacency
}

/**
 * Pick the schema's "backbone" — the object to centre the map on before any search.
 * The most-connected object (highest neighbour count) is the natural starting point;
 * ties break towards the wider table (more columns), then by id for determinism.
 *
 * @returns The chosen object's id, or `null` for an empty schema.
 */
export function pickCentre(graph: SchemaGraph): string | null {
  const adjacency = buildAdjacency(graph)
  const degreeOf = (object: SchemaObject) => adjacency.get(object.id)?.size ?? 0

  let best: SchemaObject | null = null
  let bestDegree = -1
  for (const object of graph.objects) {
    const degree = degreeOf(object)
    if (
      degree > bestDegree ||
      (degree === bestDegree && best !== null && isPreferredTieBreak(object, best))
    ) {
      best = object
      bestDegree = degree
    }
  }
  return best?.id ?? null
}

/** Tie-break between two equally-connected objects: wider table first, then id order. */
function isPreferredTieBreak(candidate: SchemaObject, current: SchemaObject): boolean {
  if (candidate.columns.length !== current.columns.length) {
    return candidate.columns.length > current.columns.length
  }
  return candidate.id < current.id
}

/**
 * The subgraph shown around a centre: the centre and its immediate (one-hop) neighbours,
 * with the relationships that run between those visible objects. Navigation is
 * map-like — clicking a neighbour makes it the new centre — so only ever one hop is
 * drawn, regardless of how large the whole schema is.
 *
 * @param graph - The full introspected schema.
 * @param centreId - The focal object; if it is missing from the graph an empty graph is returned.
 * @returns A `SchemaGraph` containing only the centre, its neighbours and their edges.
 */
export function selectNeighbourhood(graph: SchemaGraph, centreId: string): SchemaGraph {
  const byId = new Map(graph.objects.map((object) => [object.id, object]))
  if (!byId.has(centreId)) {
    return { objects: [], relationships: [] }
  }

  const adjacency = buildAdjacency(graph)
  const visible = new Set<string>([centreId, ...(adjacency.get(centreId) ?? [])])

  const objects = graph.objects.filter((object) => visible.has(object.id))
  const relationships = graph.relationships.filter(
    (relationship) => visible.has(relationship.source) && visible.has(relationship.target),
  )
  return { objects, relationships }
}
