import Dagre from '@dagrejs/dagre'
import { type Edge, MarkerType, type Node } from '@xyflow/react'

import type { SchemaGraph, SchemaObject } from '@/lib/api'

// A node's on-screen size, needed up front so dagre can lay the graph out without
// measuring the DOM. Keep these in step with the styling in table-node.tsx.
const NODE_WIDTH = 240
const HEADER_HEIGHT = 41
const ROW_HEIGHT = 22
const BODY_PADDING = 8

/** Data carried by an ER map node. The index signature satisfies React Flow's typing. */
export interface TableNodeData {
  object: SchemaObject
  /** The focal object the neighbourhood is built around; drawn with emphasis. */
  isCentre?: boolean
  /** How many related tables are off the map, shown as a stub on the outer side. */
  hiddenCount?: number
  /** Which side the stub sits on: the outer side, away from the centre. */
  stubSide?: 'left' | 'right'
  [key: string]: unknown
}

/** A React Flow node for one schema object. */
export type TableFlowNode = Node<TableNodeData, 'table'>

function nodeHeight(object: SchemaObject): number {
  return HEADER_HEIGHT + BODY_PADDING * 2 + object.columns.length * ROW_HEIGHT
}

/**
 * Position a schema graph for React Flow using a dagre layered layout.
 *
 * Foreign keys point from the referencing object to the referenced one, so a
 * left-to-right ranking places parents ahead of their children. dagre reports node
 * centres; React Flow positions nodes by their top-left corner, so each is shifted back
 * by half its size.
 *
 * @param graph - The introspected schema.
 * @returns Positioned nodes and edges ready to hand to `<ReactFlow>`.
 */
export function layoutGraph(graph: SchemaGraph): { nodes: TableFlowNode[]; edges: Edge[] } {
  const dagre = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  // Wider gaps than a dense diagram would use, so the orthogonal edges have channels to
  // run through rather than crossing under the cards.
  dagre.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 140 })

  for (const object of graph.objects) {
    dagre.setNode(object.id, { width: NODE_WIDTH, height: nodeHeight(object) })
  }
  for (const relationship of graph.relationships) {
    dagre.setEdge(relationship.source, relationship.target)
  }
  Dagre.layout(dagre)

  const nodes: TableFlowNode[] = graph.objects.map((object) => {
    const { x, y } = dagre.node(object.id)
    return {
      id: object.id,
      type: 'table',
      position: { x: x - NODE_WIDTH / 2, y: y - nodeHeight(object) / 2 },
      data: { object },
    }
  })

  const edges: Edge[] = graph.relationships.map((relationship) => ({
    id: `${relationship.source}:${relationship.constraint_name}`,
    source: relationship.source,
    target: relationship.target,
    // Orthogonal routing reads more clearly than curves that dip under the cards.
    type: 'smoothstep',
    pathOptions: { borderRadius: 12 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#9a92b4' },
    style: { stroke: '#9a92b4', strokeWidth: 1.5 },
  }))

  return { nodes, edges }
}
