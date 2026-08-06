import { describe, expect, it } from 'vitest'

import type { Relationship, RelationshipKind, SchemaGraph, SchemaObject } from '@/lib/api'

import { findPath } from './find-path'

function object(id: string): SchemaObject {
  const [schema, name] = id.split('.')
  return { id, schema, name: name ?? id, kind: 'table', columns: [], partitions: [] }
}

function edge(source: string, target: string, kind: RelationshipKind = 'foreign_key'): Relationship {
  return {
    constraint_name: `${source}->${target}`,
    source,
    source_columns: [],
    target,
    target_columns: [],
    kind,
  }
}

function graph(objectIds: string[], edges: Relationship[]): SchemaGraph {
  return { objects: objectIds.map(object), relationships: edges }
}

describe('findPath', () => {
  it('returns the two endpoints for a direct relationship', () => {
    const g = graph(['s.a', 's.b'], [edge('s.a', 's.b')])
    expect(findPath(g, 's.a', 's.b')).toEqual(['s.a', 's.b'])
  })

  it('walks a multi-hop chain in order', () => {
    const g = graph(['s.a', 's.b', 's.c'], [edge('s.a', 's.b'), edge('s.b', 's.c')])
    expect(findPath(g, 's.a', 's.c')).toEqual(['s.a', 's.b', 's.c'])
  })

  it('treats edges as undirected — a relationship pointing the other way still connects', () => {
    // The edge is declared b → a; a route a → b must still find it.
    const g = graph(['s.a', 's.b'], [edge('s.b', 's.a')])
    expect(findPath(g, 's.a', 's.b')).toEqual(['s.a', 's.b'])
  })

  it('returns just the one id when source and target are the same object', () => {
    const g = graph(['s.a', 's.b'], [edge('s.a', 's.b')])
    expect(findPath(g, 's.a', 's.a')).toEqual(['s.a'])
  })

  it('returns an empty array when the two are unreachable', () => {
    // Two disconnected components: a–b and the lone c.
    const g = graph(['s.a', 's.b', 's.c'], [edge('s.a', 's.b')])
    expect(findPath(g, 's.a', 's.c')).toEqual([])
  })

  it('returns null when either endpoint is not in the graph', () => {
    const g = graph(['s.a', 's.b'], [edge('s.a', 's.b')])
    expect(findPath(g, 's.a', 's.missing')).toBeNull()
    expect(findPath(g, 's.missing', 's.b')).toBeNull()
  })

  it('takes the shortest of several possible routes', () => {
    // a–b–d is two hops; a–c–x–d is three. The two-hop route must win.
    const g = graph(
      ['s.a', 's.b', 's.c', 's.x', 's.d'],
      [
        edge('s.a', 's.b'),
        edge('s.b', 's.d'),
        edge('s.a', 's.c'),
        edge('s.c', 's.x'),
        edge('s.x', 's.d'),
      ],
    )
    expect(findPath(g, 's.a', 's.d')).toEqual(['s.a', 's.b', 's.d'])
  })

  it('breaks ties between equally short routes by id order, deterministically', () => {
    // a connects to both m and z; each reaches the target t in one more hop. Both routes are
    // length 3, so the lower-id intermediate (m) is chosen every time.
    const g = graph(
      ['s.a', 's.m', 's.z', 's.t'],
      [edge('s.a', 's.m'), edge('s.a', 's.z'), edge('s.m', 's.t'), edge('s.z', 's.t')],
    )
    expect(findPath(g, 's.a', 's.t')).toEqual(['s.a', 's.m', 's.t'])
  })

  it('counts a relationship the user drew, and a view dependency, as connections', () => {
    const g = graph(
      ['s.a', 's.b', 's.c'],
      [edge('s.a', 's.b', 'manual'), edge('s.b', 's.c', 'view_dependency')],
    )
    expect(findPath(g, 's.a', 's.c')).toEqual(['s.a', 's.b', 's.c'])
  })

  it('ignores a relationship whose endpoint is not an object in the graph', () => {
    // The edge to the phantom s.ghost must not invent a node or a route through it.
    const g = graph(['s.a', 's.b'], [edge('s.a', 's.ghost'), edge('s.ghost', 's.b')])
    expect(findPath(g, 's.a', 's.b')).toEqual([])
  })
})
