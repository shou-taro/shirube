import { describe, expect, it } from 'vitest'

import { makeFk, makeGraph, makeObject } from '@/test/factories'

import {
  buildAdjacency,
  hiddenNeighbours,
  NEIGHBOUR_CAP,
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

describe('hiddenNeighbours', () => {
  const ids = ({ referenced, referencing }: ReturnType<typeof hiddenNeighbours>) => ({
    referenced: referenced.map((o) => o.id),
    referencing: referencing.map((o) => o.id),
  })

  it('lists off-map neighbours split by foreign-key direction, name-sorted', () => {
    const graph = makeGraph(
      [makeObject('c'), makeObject('b'), makeObject('a'), makeObject('d')],
      [makeFk('a', 'c'), makeFk('a', 'b'), makeFk('d', 'a')],
    )

    // Only `a` is visible: it references b and c (above, sorted), and d references it (below).
    expect(ids(hiddenNeighbours(graph, 'a', new Set(['a'])))).toEqual({
      referenced: ['b', 'c'],
      referencing: ['d'],
    })
  })

  it('excludes neighbours that are already visible', () => {
    const graph = makeGraph([makeObject('a'), makeObject('b')], [makeFk('a', 'b')])

    expect(ids(hiddenNeighbours(graph, 'a', new Set(['a', 'b'])))).toEqual({
      referenced: [],
      referencing: [],
    })
  })

  it('lists a repeatedly-referenced table once, and ignores self-references', () => {
    const graph = makeGraph(
      [makeObject('a'), makeObject('b')],
      [makeFk('a', 'b', 'fk1'), makeFk('a', 'b', 'fk2'), makeFk('a', 'a')],
    )

    expect(ids(hiddenNeighbours(graph, 'a', new Set(['a'])))).toEqual({
      referenced: ['b'],
      referencing: [],
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

  it('caps each direction to the alphabetically-first NEIGHBOUR_CAP neighbours', () => {
    // A hub referencing 8 tables and referenced by 8 — each direction keeps only the cap.
    const out = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8']
    const inc = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8']
    const graph = makeGraph(
      [makeObject('hub'), ...out.map((id) => makeObject(id)), ...inc.map((id) => makeObject(id))],
      [...out.map((id) => makeFk('hub', id)), ...inc.map((id) => makeFk(id, 'hub'))],
    )

    const kept = new Set(selectNeighbourhood(graph, 'hub').objects.map((o) => o.id))

    // The first six of each direction are kept (o7/o8 and i7/i8 fold into the stubs).
    expect(kept.size).toBe(1 + 2 * NEIGHBOUR_CAP)
    expect(kept.has('o6') && kept.has('i6')).toBe(true)
    expect(kept.has('o7') || kept.has('i7')).toBe(false)

    // The capped-out neighbours surface as off-map, listed by the stub.
    const hidden = hiddenNeighbours(graph, 'hub', kept)
    expect(hidden.referenced.map((o) => o.id)).toEqual(['o7', 'o8'])
    expect(hidden.referencing.map((o) => o.id)).toEqual(['i7', 'i8'])
  })
})
