import type { SchemaGraph } from '@/lib/api'

/**
 * The shortest relationship path between two objects, as a sequence of object ids running
 * source → target inclusive.
 *
 * A breadth-first walk over the relationship graph, treating every edge as **undirected** —
 * "how are these related", not "which references which", so a foreign key, a view
 * dependency or a link the user drew all count the same, in either direction. This mirrors
 * the backend `SchemaLookup.find_path` (the AI navigator's tool) so the two surfaces agree;
 * it runs in the browser because the whole graph is already loaded for the map, so no
 * round-trip or re-introspection is needed and manual relationships are included for free.
 *
 * When several shortest paths exist, neighbours are visited in id order, so the result is
 * stable across runs.
 *
 * @param graph - The loaded schema (its objects and relationships).
 * @param source - The `schema.name` id to start from.
 * @param target - The `schema.name` id to reach.
 * @returns The hop ids from `source` to `target` inclusive (`[source]` when they are the
 *   same object; an empty array when the two are unreachable), or `null` when either
 *   endpoint is not an object in the graph.
 */
export function findPath(
  graph: SchemaGraph,
  source: string,
  target: string,
): string[] | null {
  const ids = new Set(graph.objects.map((object) => object.id))
  if (!ids.has(source) || !ids.has(target)) {
    return null
  }
  if (source === target) {
    return [source]
  }

  // Undirected adjacency: each relationship connects its endpoints both ways. Built only
  // from edges whose endpoints both exist, so a dangling relationship never invents a node.
  const neighbours = new Map<string, Set<string>>()
  for (const id of ids) {
    neighbours.set(id, new Set())
  }
  for (const relationship of graph.relationships) {
    const from = neighbours.get(relationship.source)
    const to = neighbours.get(relationship.target)
    if (from !== undefined && to !== undefined) {
      from.add(relationship.target)
      to.add(relationship.source)
    }
  }

  // BFS, tracking each node's predecessor so the path can be reconstructed on arrival.
  const predecessor = new Map<string, string>([[source, source]])
  const queue: string[] = [source]
  while (queue.length > 0) {
    const current = queue.shift() as string
    // Sorted so that, among equally short paths, the same one is chosen every time.
    const adjacent = [...(neighbours.get(current) ?? [])].sort()
    for (const neighbour of adjacent) {
      if (predecessor.has(neighbour)) {
        continue
      }
      predecessor.set(neighbour, current)
      if (neighbour === target) {
        return reconstruct(predecessor, source, target)
      }
      queue.push(neighbour)
    }
  }

  // Exhausted the component reachable from the source without meeting the target.
  return []
}

/** Walk predecessors back from `target` to `source`, then reverse to a forward path. */
function reconstruct(
  predecessor: Map<string, string>,
  source: string,
  target: string,
): string[] {
  const path = [target]
  while (path[path.length - 1] !== source) {
    path.push(predecessor.get(path[path.length - 1]) as string)
  }
  path.reverse()
  return path
}
