import { describe, expect, it } from 'vitest'

import { makeFk, makeGraph, makeObject } from '@/test/factories'

import {
  buildAdjacency,
  hiddenByReference,
  pickCentre,
  selectNeighbourhood,
} from './neighbourhood'

describe('buildAdjacency', () => {
  it('links related objects in both directions', () => {
    const graph = makeGraph(
      [makeObject('a'), makeObject('b'), makeObject('c')],
      [makeFk('a', 'b'), makeFk('b', 'c')],
    )

    const adjacency = buildAdjacency(graph)

    expect(adjacency.get('a')).toEqual(new Set(['b']))
    expect(adjacency.get('b')).toEqual(new Set(['a', 'c']))
    expect(adjacency.get('c')).toEqual(new Set(['b']))
  })

  it('ignores self-references', () => {
    const graph = makeGraph([makeObject('a')], [makeFk('a', 'a')])

    expect(buildAdjacency(graph).has('a')).toBe(false)
  })
})

describe('pickCentre', () => {
  it('chooses the most-connected object', () => {
    // b is related to both a and c; a and c only to b.
    const graph = makeGraph(
      [makeObject('a'), makeObject('b'), makeObject('c')],
      [makeFk('a', 'b'), makeFk('b', 'c')],
    )

    expect(pickCentre(graph)).toBe('b')
  })

  it('breaks a degree tie towards the wider table', () => {
    // Every object has degree 1, so the tie-break decides: the widest table (n, 5 cols).
    const graph = makeGraph(
      [makeObject('m', 2), makeObject('n', 5), makeObject('p', 1), makeObject('q', 1)],
      [makeFk('m', 'p'), makeFk('n', 'q')],
    )

    expect(pickCentre(graph)).toBe('n')
  })

  it('breaks a degree-and-width tie by id order', () => {
    const graph = makeGraph(
      [makeObject('beta', 3), makeObject('alpha', 3)],
      [makeFk('alpha', 'beta')],
    )

    // Both have degree 1 and 3 columns; the lexicographically smaller id wins.
    expect(pickCentre(graph)).toBe('alpha')
  })

  it('returns null for an empty schema', () => {
    expect(pickCentre(makeGraph([]))).toBeNull()
  })
})

describe('hiddenByReference', () => {
  it('counts off-map neighbours split by foreign-key direction', () => {
    const graph = makeGraph(
      [makeObject('a'), makeObject('b'), makeObject('c'), makeObject('d')],
      [makeFk('a', 'b'), makeFk('a', 'c'), makeFk('d', 'a')],
    )

    // Only `a` is visible: it references b and c (above), and d references it (below).
    const counts = hiddenByReference(graph, 'a', new Set(['a']))

    expect(counts).toEqual({ referenced: 2, referencing: 1 })
  })

  it('does not count neighbours that are already visible', () => {
    const graph = makeGraph(
      [makeObject('a'), makeObject('b')],
      [makeFk('a', 'b')],
    )

    expect(hiddenByReference(graph, 'a', new Set(['a', 'b']))).toEqual({
      referenced: 0,
      referencing: 0,
    })
  })

  it('counts a repeatedly-referenced table only once, and ignores self-references', () => {
    const graph = makeGraph(
      [makeObject('a'), makeObject('b')],
      [makeFk('a', 'b', 'fk1'), makeFk('a', 'b', 'fk2'), makeFk('a', 'a')],
    )

    expect(hiddenByReference(graph, 'a', new Set(['a']))).toEqual({
      referenced: 1,
      referencing: 0,
    })
  })
})

describe('selectNeighbourhood', () => {
  it('keeps the centre, its one-hop neighbours and the edges among them', () => {
    // b is the centre; a and c are neighbours; d hangs off a and stays off-map.
    const graph = makeGraph(
      [makeObject('a'), makeObject('b'), makeObject('c'), makeObject('d')],
      [makeFk('a', 'b'), makeFk('b', 'c'), makeFk('a', 'c'), makeFk('a', 'd')],
    )

    const neighbourhood = selectNeighbourhood(graph, 'b')

    expect(new Set(neighbourhood.objects.map((o) => o.id))).toEqual(new Set(['a', 'b', 'c']))
    // a-b, b-c and a-c are all between visible objects; a-d is dropped (d is off-map).
    const edges = neighbourhood.relationships.map((r) => `${r.source}->${r.target}`)
    expect(new Set(edges)).toEqual(new Set(['a->b', 'b->c', 'a->c']))
  })

  it('returns an empty graph when the centre is not in the schema', () => {
    const graph = makeGraph([makeObject('a')], [])

    expect(selectNeighbourhood(graph, 'missing')).toEqual({ objects: [], relationships: [] })
  })
})
