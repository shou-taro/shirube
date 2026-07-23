import Dagre from '@dagrejs/dagre'
import { type Edge, MarkerType, type Node } from '@xyflow/react'

import type { SchemaGraph, SchemaObject } from '@/lib/api'

// A node's on-screen size, needed up front so dagre can lay the graph out without
// measuring the DOM — and set explicitly on each node so the MiniMap, which skips nodes
// of unknown size, can draw them. Keep these in step with the styling in table-node.tsx:
// header 37, one border pair 2, list padding 8 (py-1 top and bottom), each row 22.
const NODE_WIDTH = 240
const HEADER_HEIGHT = 37
const ROW_HEIGHT = 22
const BODY_PADDING = 4
const BORDER = 2

/** Data carried by an ER map node. The index signature satisfies React Flow's typing. */
export interface TableNodeData {
  object: SchemaObject
  /** The focal object the neighbourhood is built around; drawn with emphasis. */
  isCentre?: boolean
  /** Off-map tables this one references — listed under a stub above the node. */
  hiddenReferenced?: SchemaObject[]
  /** Off-map tables that reference this one — listed under a stub below the node. */
  hiddenReferencing?: SchemaObject[]
  /** Travel the map to another object — used by the stub's list to hop to a hidden one. */
  onTravel?: (id: string) => void
  [key: string]: unknown
}

/** A React Flow node for one schema object. */
export type TableFlowNode = Node<TableNodeData, 'table'>

function nodeHeight(object: SchemaObject): number {
  return HEADER_HEIGHT + BORDER + BODY_PADDING * 2 + object.columns.length * ROW_HEIGHT
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
  // A multigraph so parallel foreign keys between the same pair of tables can each be a
  // named edge rather than collapsing into one.
  const dagre = new Dagre.graphlib.Graph({ multigraph: true }).setDefaultEdgeLabel(() => ({}))
  // Wider gaps than a dense diagram would use, so the orthogonal edges have channels to
  // run through rather than crossing under the cards.
  dagre.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 140 })

  for (const object of graph.objects) {
    dagre.setNode(object.id, { width: NODE_WIDTH, height: nodeHeight(object) })
  }
  for (const relationship of graph.relationships) {
    // Name the edge so parallel foreign keys between the same pair don't collide.
    dagre.setEdge(relationship.source, relationship.target, {}, relationship.constraint_name)
  }
  Dagre.layout(dagre)

  const nodes: TableFlowNode[] = graph.objects.map((object) => {
    const { x, y } = dagre.node(object.id)
    const height = nodeHeight(object)
    return {
      id: object.id,
      type: 'table',
      position: { x: x - NODE_WIDTH / 2, y: y - height / 2 },
      // Explicit dimensions match the card so the MiniMap renders each node.
      width: NODE_WIDTH,
      height,
      data: { object },
    }
  })

  const edges: Edge[] = graph.relationships.map((relationship) => {
    // dagre routes edges around the nodes in intermediate ranks; carry its waypoints so
    // the edge follows that path instead of cutting straight under a card.
    const routed = dagre.edge({
      v: relationship.source,
      w: relationship.target,
      name: relationship.constraint_name,
    }) as { points?: { x: number; y: number }[] } | undefined
    // A view dependency (a view reading a relation) is drawn dashed to set it apart from
    // a solid foreign key.
    const isDependency = relationship.kind === 'view_dependency'
    return {
      id: `${relationship.source}:${relationship.constraint_name}`,
      source: relationship.source,
      target: relationship.target,
      type: 'routed',
      data: { points: routed?.points ?? [] },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#9a92b4' },
      style: {
        stroke: '#9a92b4',
        strokeWidth: 1.5,
        ...(isDependency ? { strokeDasharray: '5 4' } : {}),
      },
    }
  })

  return { nodes, edges }
}
