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
 * The most neighbours drawn per direction before the rest fold into an off-map stub. A
 * hub table can have dozens of one-hop neighbours; drawing them all stacks them into an
 * unreadable vertical strip (they share a layout rank). Capping each direction keeps the
 * map legible, and nothing is lost — the overflow is reachable from the stub and the
 * detail card. Applied per direction because the layout already splits the two.
 */
export const NEIGHBOUR_CAP = 6

/** Order two object ids by their object's name, then id, for a stable alphabetical sort. */
function byObjectName(byId: ReadonlyMap<string, SchemaObject>) {
  return (a: string, b: string): number => {
    const nameA = byId.get(a)?.name ?? a
    const nameB = byId.get(b)?.name ?? b
    return nameA.localeCompare(nameB) || a.localeCompare(b)
  }
}

/**
 * An object's neighbours, split by foreign-key direction: tables it references (its FKs
 * point out to these) and tables that reference it. Self-references and repeats collapse
 * to one entry. Used both to choose which neighbours to draw and to list the off-map rest.
 */
function neighboursByDirection(
  graph: SchemaGraph,
  id: string,
): { referenced: Set<string>; referencing: Set<string> } {
  const referenced = new Set<string>() // tables `id` references (id -> target)
  const referencing = new Set<string>() // tables that reference `id` (source -> id)
  for (const relationship of graph.relationships) {
    if (relationship.source === relationship.target) {
      continue
    }
    if (relationship.source === id) {
      referenced.add(relationship.target)
    }
    if (relationship.target === id) {
      referencing.add(relationship.source)
    }
  }
  return { referenced, referencing }
}

/**
 * An object's *off-map* neighbours, split by foreign-key direction — the neighbours not
 * drawn on the current map, so they can be listed under the stub above (tables it
 * references) or below (tables that reference it) the node. The horizontal axis already
 * lays visible edges left-to-right by direction, so these hidden ones sit on the vertical
 * axis instead, never colliding with a visible edge. Each list is name-sorted.
 *
 * @returns The hidden objects: `referenced` (drawn above), `referencing` (below).
 */
export function hiddenNeighbours(
  graph: SchemaGraph,
  id: string,
  visibleIds: ReadonlySet<string>,
): { referenced: SchemaObject[]; referencing: SchemaObject[] } {
  const byId = new Map(graph.objects.map((object) => [object.id, object]))
  const { referenced, referencing } = neighboursByDirection(graph, id)
  const toObjects = (ids: Set<string>): SchemaObject[] =>
    [...ids]
      .filter((neighbourId) => !visibleIds.has(neighbourId))
      .sort(byObjectName(byId))
      .map((neighbourId) => byId.get(neighbourId))
      .filter((object): object is SchemaObject => object !== undefined)
  return { referenced: toObjects(referenced), referencing: toObjects(referencing) }
}

/**
 * The subgraph shown around a centre: the centre and up to {@link NEIGHBOUR_CAP} of its
 * immediate (one-hop) neighbours *per direction*, with the relationships that run between
 * those visible objects. Navigation is map-like — clicking a neighbour makes it the new
 * centre — so only ever one hop is drawn, regardless of how large the whole schema is; the
 * per-direction cap keeps even a hub table's neighbourhood readable (see
 * {@link hiddenNeighbours} for the overflow). Kept neighbours are the alphabetically-first
 * of each direction, so the choice is stable and scannable.
 *
 * @param graph - The full introspected schema.
 * @param centreId - The focal object; if it is missing from the graph an empty graph is returned.
 * @returns A `SchemaGraph` containing only the centre, the kept neighbours and their edges.
 */
export function selectNeighbourhood(graph: SchemaGraph, centreId: string): SchemaGraph {
  const byId = new Map(graph.objects.map((object) => [object.id, object]))
  if (!byId.has(centreId)) {
    return { objects: [], relationships: [] }
  }

  const { referenced, referencing } = neighboursByDirection(graph, centreId)
  const keep = (ids: Set<string>): string[] =>
    [...ids].filter((id) => byId.has(id)).sort(byObjectName(byId)).slice(0, NEIGHBOUR_CAP)
  const visible = new Set<string>([centreId, ...keep(referenced), ...keep(referencing)])

  const objects = graph.objects.filter((object) => visible.has(object.id))
  const relationships = graph.relationships.filter(
    (relationship) => visible.has(relationship.source) && visible.has(relationship.target),
  )
  return { objects, relationships }
}
