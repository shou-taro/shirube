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

import { layoutGraph, type TableFlowNode, type TableNodeData } from './layout'
import { hiddenNeighbours, pickCentre, selectNeighbourhood } from './neighbourhood'
import { RoutedEdge } from './routed-edge'
import { TableNode } from './table-node'
import { withLeaving } from './transition'

// Registered once at module scope: React Flow warns if these object identities change
// between renders.
const nodeTypes = { table: TableNode }
const edgeTypes = { routed: RoutedEdge }

// How much breathing room fitView leaves around the diagram, as a fraction of the pane.
// Kept modest so the neighbourhood fills the canvas rather than floating in whitespace,
// while still leaving room for the vertical off-map stubs above and below the cards.
const FIT_PADDING = 0.15

// How long the camera takes to pan/zoom to the new neighbourhood on travel. Paired with the
// node glide in index.css (`.react-flow__node` transform transition), so the clicked table's
// slide to the centre and the camera framing it arrive together as one move — keep the two
// in step.
const TRAVEL_FIT_MS = 460

// The arrival cascade after the centre lands: neighbours ripple out from the centre, nearest
// first. Each relationship starts drawing at EDGE_ENTER_BASE + slot·STAGGER_STEP ms; the
// table at its far end settles in NODE_ENTER_LEAD later, so the arrow visibly leads and the
// table follows once it has nearly drawn. The slot is capped so a hub's dozen neighbours
// don't stretch the cascade indefinitely. Durations for the draw and the pop live in
// index.css (`.er-edge-draw-in` / `.er-card-enter`); keep the lead a touch under the edge
// duration there so a table lands as its arrow completes.
const EDGE_ENTER_BASE = 180
const NODE_ENTER_LEAD = 300
const STAGGER_STEP = 100
const STAGGER_CAP = 7

// How long the tables and edges leaving the view are kept mounted so they can ease out
// before they are dropped. Pair with the exit animations in index.css (`.er-card-leave` /
// `.er-edge-leave`) — a touch longer, so removal lands just after the animation ends.
const EXIT_MS = 300

/**
 * Refit the view when the focus changes — travelling to a new centre or toggling the
 * show-everything view — so the fresh set of nodes is framed. Lives inside <ReactFlow>
 * to reach its instance.
 */
function FitOnChange({ signature, fitIds }: { signature: string; fitIds: string[] }) {
  const { fitView } = useReactFlow()
  // Read the ids fresh at fire time without making them an effect dependency, so the fit
  // re-runs only when the focus changes (signature), not on every render.
  const idsRef = useRef(fitIds)
  idsRef.current = fitIds
  useEffect(() => {
    // Start the pan only once the freshly-swapped layout has painted, so the animation
    // runs on an unblocked main thread instead of stuttering against the node mount and
    // the surrounding re-render on the same frame. Two frames: the first lets React's
    // commit paint, the second starts the pan on a clear frame.
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(
        () =>
          void fitView({
            padding: FIT_PADDING,
            duration: TRAVEL_FIT_MS,
            // Frame the arriving neighbourhood only; the tables leaving the view still linger
            // (easing out at their old spots) and must not drag the camera off the new one.
            nodes: idsRef.current.map((id) => ({ id })),
          }),
      )
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
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
    const timer = setTimeout(() => void fitView({ padding: FIT_PADDING, duration: 400 }), 260)
    return () => clearTimeout(timer)
  }, [trigger, fitView])
  return null
}

interface ErDiagramProps {
  graph: SchemaGraph
  /** A table chosen via search to centre on; falls back to the backbone when unset. */
  centreOverride?: string | null
  /** Notified with the current centre's id whenever it changes, so the surrounding
   *  workspace can show that table's detail. Null before a centre is picked. */
  onCentreChange?: (id: string | null) => void
  /** Open showing the whole schema rather than a neighbourhood (a startup preference). */
  defaultShowAll?: boolean
  /** Changes when a side pane toggles, so the map can refit to the new width. */
  resizeKey?: unknown
  /** Remove a manual relationship by id — wired to the delete control on its map edge. */
  onRemoveManual?: (relationshipId: string) => void
}

/**
 * The ER map: schema objects as cards, foreign keys as edges, laid out automatically.
 *
 * Rather than drawing the whole schema, the map centres on one table and shows just its
 * immediate neighbours — like a map zoomed to a place. Clicking a neighbour travels the
 * centre to it, so the view is always "centre + neighbours" however large the schema is.
 * A show-everything toggle covers small databases.
 */
export function ErDiagram({
  graph,
  centreOverride = null,
  onCentreChange,
  defaultShowAll = false,
  resizeKey,
  onRemoveManual,
}: ErDiagramProps) {
  const { t } = useTranslation()
  const [centreId, setCentreId] = useState<string | null>(() => pickCentre(graph))
  const [showAll, setShowAll] = useState(defaultShowAll)

  // Travel to a new centre by swapping the neighbourhood straight away and letting the
  // arrival choreograph itself (see index.css): the clicked table keeps its identity across
  // the swap, so it glides to the middle while the camera reframes (FitOnChange); its
  // relationships then draw outward and the newly-related tables settle in behind them.
  const travelTo = useCallback((id: string) => {
    setCentreId(id)
    setShowAll(false)
  }, [])

  // A fresh schema keeps the current centre when that table is still present — so reloading,
  // or adding a manual relationship, does not throw the user back to the backbone — and only
  // falls back to the backbone when there is no centre yet or it has gone.
  useEffect(() => {
    setCentreId((current) =>
      current !== null && graph.objects.some((object) => object.id === current)
        ? current
        : pickCentre(graph),
    )
  }, [graph])

  // A search selection travels the centre there.
  useEffect(() => {
    if (centreOverride !== null && graph.objects.some((object) => object.id === centreOverride)) {
      travelTo(centreOverride)
    }
  }, [centreOverride, graph, travelTo])

  // Report the current centre upward so the workspace can show its detail.
  useEffect(() => {
    onCentreChange?.(centreId)
  }, [centreId, onCentreChange])

  const target = useMemo(() => {
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

    // Order the neighbours by distance from the centre so the arrival ripples outward, and
    // give each a stagger slot. The centre has no slot — it glides in rather than popping.
    const centre = laid.nodes.find((node) => node.id === centreId)
    const cx = centre?.position.x ?? 0
    const cy = centre?.position.y ?? 0
    const slotOf = new Map<string, number>()
    laid.nodes
      .filter((node) => node.id !== centreId)
      .map((node) => ({
        id: node.id,
        distance: Math.hypot(node.position.x - cx, node.position.y - cy),
      }))
      .sort((a, b) => a.distance - b.distance)
      .forEach((neighbour, index) => slotOf.set(neighbour.id, Math.min(index, STAGGER_CAP)))

    const nodes = laid.nodes.map((node) => {
      // Off-map neighbours are marked with vertical stubs (above/below), clear of the
      // horizontal foreign-key edges, split by reference direction. The stub lists them
      // and travels there on click, so a capped hub loses nothing.
      const { referenced, referencing } = hiddenNeighbours(graph, node.id, visibleIds)
      const slot = slotOf.get(node.id) ?? 0
      return {
        ...node,
        data: {
          ...node.data,
          isCentre: node.id === centreId,
          hiddenReferenced: referenced,
          hiddenReferencing: referencing,
          onTravel: travelTo,
          enterDelay: node.id === centreId ? 0 : EDGE_ENTER_BASE + NODE_ENTER_LEAD + slot * STAGGER_STEP,
        },
      }
    })

    // An edge draws in on the same slot as the neighbour it reaches, so the arrow leads the
    // table that appears at its far end. It also draws from the centre outward whichever way
    // the foreign key points: when the centre is the edge's target, routed-edge.tsx reverses
    // the reveal so the line still grows from the centre rather than towards it.
    const edges: Edge[] = laid.edges.map((edge) => {
      const neighbour = edge.source === centreId ? edge.target : edge.source
      const slot = slotOf.get(neighbour) ?? 0
      return {
        ...edge,
        data: {
          ...edge.data,
          enterDelay: EDGE_ENTER_BASE + slot * STAGGER_STEP,
          drawFromTarget: edge.target === centreId,
        },
      }
    })
    return { nodes, edges }
  }, [showAll, graph, centreId, travelTo])

  // Keep the departing neighbourhood on screen for one exit beat so it eases out rather than
  // vanishing the instant the layout swaps: render the target plus whatever is leaving it
  // (flagged by withLeaving), then drop the flagged items once their animation has played.
  const [rendered, setRendered] = useState(() => target)
  useEffect(() => {
    setRendered((previous) => ({
      nodes: withLeaving(target.nodes, previous.nodes),
      edges: withLeaving(target.edges, previous.edges),
    }))
    const timer = window.setTimeout(() => setRendered(target), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [target])

  // Wire each manual edge's on-map delete control to the remove handler. Kept out of the
  // layout above so it stays a pure geometry step, independent of this callback.
  const edgesWithHandlers = useMemo(
    () =>
      onRemoveManual === undefined
        ? rendered.edges
        : rendered.edges.map((edge) =>
            edge.data?.manual === true
              ? { ...edge, data: { ...edge.data, onRemove: onRemoveManual } }
              : edge,
          ),
    [rendered.edges, onRemoveManual],
  )

  // Clicking a neighbour travels the centre to it; clicking the centre does nothing.
  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      travelTo(node.id)
    },
    [travelTo],
  )

  return (
    <ReactFlow
      nodes={rendered.nodes}
      edges={edgesWithHandlers}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={handleNodeClick}
      nodesDraggable={false}
      fitView
      fitViewOptions={{ padding: FIT_PADDING }}
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <FitOnChange
        signature={showAll ? 'all' : centreId ?? ''}
        fitIds={target.nodes.map((node) => node.id)}
      />
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
      <MiniMap
        pannable
        zoomable
        position="top-right"
        className="!rounded-lg !border !border-brand/20 !bg-card"
        style={{ width: 140, height: 100 }}
        maskColor="rgba(167, 139, 250, 0.12)"
        nodeStrokeColor="#a78bfa"
        nodeColor={(node) => ((node.data as TableNodeData).isCentre ? '#a78bfa' : '#cdbef7')}
        nodeBorderRadius={3}
      />
    </ReactFlow>
  )
}
