import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SchemaGraph } from '@/lib/api'

import { layoutGraph, type TableFlowNode } from './layout'
import {
  buildAdjacency,
  hiddenNeighbourCount,
  pickCentre,
  selectNeighbourhood,
} from './neighbourhood'
import { TableNode } from './table-node'

// Registered once at module scope: React Flow warns if this object identity changes
// between renders.
const nodeTypes = { table: TableNode }

/**
 * Refit the view whenever the visible set changes (a new centre, or an expand/collapse),
 * so freshly revealed nodes come into view. Lives inside <ReactFlow> to reach its
 * instance. `signature` changes exactly when the neighbourhood does.
 */
function FitOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    void fitView({ padding: 0.2, duration: 400 })
  }, [signature, fitView])
  return null
}

/**
 * The ER map: schema objects as cards, foreign keys as edges, laid out automatically.
 *
 * Rather than drawing the whole schema, the map centres on the most-connected table and
 * shows its immediate neighbourhood. Each node with off-map neighbours can be expanded
 * to reveal them, panning the map outward one hop at a time.
 */
export function ErDiagram({ graph }: { graph: SchemaGraph }) {
  const { t } = useTranslation()
  const centreId = useMemo(() => pickCentre(graph), [graph])
  const adjacency = useMemo(() => buildAdjacency(graph), [graph])
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const [showAll, setShowAll] = useState(false)

  // A change of schema or centre starts the neighbourhood afresh.
  useEffect(() => {
    setExpandedIds(new Set())
  }, [centreId])

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const { nodes, edges } = useMemo(() => {
    // "Show everything" draws the whole schema plainly — no centre, no expand affordances.
    if (showAll) {
      return layoutGraph(graph)
    }
    if (centreId === null) {
      return { nodes: [] as TableFlowNode[], edges: [] as Edge[] }
    }
    const subgraph = selectNeighbourhood(graph, centreId, expandedIds)
    const visibleIds = new Set(subgraph.objects.map((object) => object.id))
    const laid = layoutGraph(subgraph)
    const nodes = laid.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isCentre: node.id === centreId,
        expanded: expandedIds.has(node.id),
        hiddenCount: hiddenNeighbourCount(adjacency, node.id, visibleIds),
        onToggleExpand: toggleExpand,
      },
    }))
    return { nodes, edges: laid.edges }
  }, [showAll, graph, centreId, expandedIds, adjacency, toggleExpand])

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
      <FitOnChange signature={`${showAll ? 'all' : centreId ?? ''}:${nodes.length}`} />
      {/* Show-everything escape hatch for small schemas, kept clear of the detail card
          (top-left) and the controls/minimap (right). */}
      <Panel position="bottom-left">
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-brand/10 hover:text-brand"
        >
          {showAll ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          {showAll ? t('schema.focus') : t('schema.showAll')}
        </button>
      </Panel>
      <Background />
      {/* Controls and minimap sit on the right, clear of the table-detail card that
          floats (and expands) down the left edge. */}
      <Controls showInteractive={false} position="bottom-right" />
      <MiniMap pannable zoomable position="top-right" style={{ width: 140, height: 100 }} />
    </ReactFlow>
  )
}
