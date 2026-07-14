import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'

import type { SchemaGraph } from '@/lib/api'

import { layoutGraph } from './layout'
import { pickCentre, selectNeighbourhood } from './neighbourhood'
import { TableNode } from './table-node'

// Registered once at module scope: React Flow warns if this object identity changes
// between renders.
const nodeTypes = { table: TableNode }

// A stable empty set for the not-yet-expanded case, so the layout memo is not
// invalidated by a fresh set on every render.
const NO_EXPANSIONS: ReadonlySet<string> = new Set()

/**
 * The ER map: schema objects as cards, foreign keys as edges, laid out automatically.
 *
 * Rather than drawing the whole schema, the map centres on the most-connected table and
 * shows only its immediate neighbourhood; expanding nodes and moving the centre come
 * with later work.
 */
export function ErDiagram({ graph }: { graph: SchemaGraph }) {
  const centreId = useMemo(() => pickCentre(graph), [graph])
  const { nodes, edges } = useMemo(() => {
    if (centreId === null) {
      return { nodes: [], edges: [] }
    }
    return layoutGraph(selectNeighbourhood(graph, centreId, NO_EXPANSIONS))
  }, [graph, centreId])
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      {/* Controls and minimap sit on the right, clear of the table-detail card that
          floats (and expands) down the left edge. */}
      <Controls showInteractive={false} position="bottom-right" />
      <MiniMap pannable zoomable position="top-right" style={{ width: 140, height: 100 }} />
    </ReactFlow>
  )
}
