import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type NodeMouseHandler,
  Panel,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SchemaGraph } from '@/lib/api'

import { layoutGraph, type TableFlowNode } from './layout'
import { hiddenByDirection, pickCentre, selectNeighbourhood } from './neighbourhood'
import { TableNode } from './table-node'

// Registered once at module scope: React Flow warns if this object identity changes
// between renders.
const nodeTypes = { table: TableNode }

/**
 * Refit the view when the focus changes — travelling to a new centre or toggling the
 * show-everything view — so the fresh set of nodes is framed. Lives inside <ReactFlow>
 * to reach its instance.
 */
function FitOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    void fitView({ padding: 0.25, duration: 400 })
  }, [signature, fitView])
  return null
}

/**
 * Refit after the map is resized by a side pane sliding open or shut. The refit is
 * delayed past the pane's width animation so it frames the final width, and the first
 * render is skipped (initial framing is handled elsewhere).
 */
function RefitAfterResize({ trigger }: { trigger: unknown }) {
  const { fitView } = useReactFlow()
  const isFirst = useRef(true)
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    const timer = setTimeout(() => void fitView({ padding: 0.25, duration: 400 }), 260)
    return () => clearTimeout(timer)
  }, [trigger, fitView])
  return null
}

interface ErDiagramProps {
  graph: SchemaGraph
  /** A table chosen via search to centre on; falls back to the backbone when unset. */
  centreOverride?: string | null
  /** Changes when a side pane toggles, so the map can refit to the new width. */
  resizeKey?: unknown
}

/**
 * The ER map: schema objects as cards, foreign keys as edges, laid out automatically.
 *
 * Rather than drawing the whole schema, the map centres on one table and shows just its
 * immediate neighbours — like a map zoomed to a place. Clicking a neighbour travels the
 * centre to it, so the view is always "centre + neighbours" however large the schema is.
 * A show-everything toggle covers small databases.
 */
export function ErDiagram({ graph, centreOverride = null, resizeKey }: ErDiagramProps) {
  const { t } = useTranslation()
  const [centreId, setCentreId] = useState<string | null>(() => pickCentre(graph))
  const [showAll, setShowAll] = useState(false)

  // A fresh schema resets the centre to its backbone.
  useEffect(() => {
    setCentreId(pickCentre(graph))
  }, [graph])

  // A search selection travels the centre there (and leaves the show-everything view).
  useEffect(() => {
    if (centreOverride !== null && graph.objects.some((object) => object.id === centreOverride)) {
      setCentreId(centreOverride)
      setShowAll(false)
    }
  }, [centreOverride, graph])

  const { nodes, edges } = useMemo(() => {
    // "Show everything" draws the whole schema plainly — no centre, nothing hidden.
    if (showAll) {
      return layoutGraph(graph)
    }
    if (centreId === null) {
      return { nodes: [] as TableFlowNode[], edges: [] as Edge[] }
    }
    const subgraph = selectNeighbourhood(graph, centreId)
    const visibleIds = new Set(subgraph.objects.map((object) => object.id))
    const laid = layoutGraph(subgraph)
    const nodes = laid.nodes.map((node) => {
      // Split the off-map neighbours by side, so a stub points to where they'd be.
      const { left, right } = hiddenByDirection(graph, node.id, visibleIds)
      return {
        ...node,
        data: { ...node.data, isCentre: node.id === centreId, hiddenLeft: left, hiddenRight: right },
      }
    })
    return { nodes, edges: laid.edges }
  }, [showAll, graph, centreId])

  // Clicking a neighbour travels the centre to it; clicking the centre does nothing.
  const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    setCentreId(node.id)
  }, [])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      nodesDraggable={false}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <FitOnChange signature={showAll ? 'all' : centreId ?? ''} />
      <RefitAfterResize trigger={resizeKey} />
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
