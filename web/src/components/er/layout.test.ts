import { describe, expect, it } from 'vitest'

import { makeFk, makeGraph, makeObject, makeViewDep } from '@/test/factories'

import { layoutGraph } from './layout'

// Node geometry the layout must reproduce (see layout.ts): header 37 + border 2 +
// body padding 8 + 22 per column.
const NODE_WIDTH = 240
const BASE_HEIGHT = 47

describe('layoutGraph node sizing', () => {
  it('gives every node an explicit width and a height that grows with its columns', () => {
    const graph = makeGraph([makeObject('a', 0), makeObject('b', 3)])

    const { nodes } = layoutGraph(graph)
    const byId = new Map(nodes.map((node) => [node.id, node]))

    // Explicit dimensions are what let the MiniMap draw the nodes at all.
    expect(byId.get('a')?.width).toBe(NODE_WIDTH)
    expect(byId.get('a')?.height).toBe(BASE_HEIGHT)
    expect(byId.get('b')?.height).toBe(BASE_HEIGHT + 3 * 22)
  })

  it('produces one node per object', () => {
    const graph = makeGraph([makeObject('a'), makeObject('b'), makeObject('c')], [makeFk('a', 'b')])

    expect(layoutGraph(graph).nodes).toHaveLength(3)
  })
})

describe('layoutGraph edges', () => {
  it('draws a view dependency dashed and a foreign key solid', () => {
    const graph = makeGraph(
      [makeObject('t'), makeObject('v')],
      [makeFk('t', 'v', 'fk'), makeViewDep('v', 't', 'dep')],
    )

    const { edges } = layoutGraph(graph)
    const fk = edges.find((edge) => edge.id === 't:fk')
    const dep = edges.find((edge) => edge.id === 'v:dep')

    expect(fk?.style?.strokeDasharray).toBeUndefined()
    expect(dep?.style?.strokeDasharray).toBe('5 4')
  })

  it('keeps parallel foreign keys between the same pair as separate edges', () => {
    const graph = makeGraph(
      [makeObject('a'), makeObject('b')],
      [makeFk('a', 'b', 'fk1'), makeFk('a', 'b', 'fk2')],
    )

    const { edges } = layoutGraph(graph)

    expect(edges).toHaveLength(2)
    expect(new Set(edges.map((edge) => edge.id))).toEqual(new Set(['a:fk1', 'a:fk2']))
  })

  it('carries the routing waypoints dagre computed', () => {
    const graph = makeGraph([makeObject('a'), makeObject('b')], [makeFk('a', 'b', 'fk')])

    const [edge] = layoutGraph(graph).edges

    expect(edge.source).toBe('a')
    expect(edge.target).toBe('b')
    expect(Array.isArray((edge.data as { points: unknown[] }).points)).toBe(true)
  })
})
