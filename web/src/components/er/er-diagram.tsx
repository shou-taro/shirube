import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'

import type { SchemaGraph } from '@/lib/api'

import { layoutGraph } from './layout'
import { TableNode } from './table-node'

// Registered once at module scope: React Flow warns if this object identity changes
// between renders.
const nodeTypes = { table: TableNode }

/**
 * The ER map: schema objects as cards, foreign keys as edges, laid out automatically.
 *
 * The whole schema is drawn for now; centring on a starting table and expanding its
 * neighbourhood comes with later work.
 */
export function ErDiagram({ graph }: { graph: SchemaGraph }) {
  const { nodes, edges } = useMemo(() => layoutGraph(graph), [graph])
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable style={{ width: 140, height: 100 }} />
    </ReactFlow>
  )
}
