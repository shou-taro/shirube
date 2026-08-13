import { EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import { X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

/** A waypoint on a dagre-routed edge. */
interface Point {
  x: number
  y: number
}

const CORNER_RADIUS = 16

/**
 * Build an SVG path through the waypoints, keeping the straight segments straight and
 * only rounding the bends. Each interior point becomes a short quadratic arc, so the
 * dagre-routed edge reads smoothly without the wobble a spline through every point would
 * add.
 */
function roundedPath(points: Point[]): string {
  if (points.length < 2) {
    return ''
  }
  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]
    const curr = points[i]
    const next = points[i + 1]
    const entry = shortenTowards(curr, prev, CORNER_RADIUS)
    const exit = shortenTowards(curr, next, CORNER_RADIUS)
    path += ` L ${entry.x} ${entry.y} Q ${curr.x} ${curr.y} ${exit.x} ${exit.y}`
  }
  const last = points[points.length - 1]
  path += ` L ${last.x} ${last.y}`
  return path
}

/** A point `distance` away from `from`, moving towards `to` (clamped to half the segment). */
function shortenTowards(from: Point, to: Point, distance: number): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length === 0) {
    return from
  }
  const ratio = Math.min(distance, length / 2) / length
  return { x: from.x + dx * ratio, y: from.y + dy * ratio }
}

/**
 * An edge that follows dagre's computed waypoints, so it routes around the nodes in
 * intermediate ranks instead of cutting straight under a card. The handle positions from
 * React Flow anchor the two ends; dagre's interior points shape the middle.
 */
export function RoutedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const waypoints = (data?.points as Point[] | undefined) ?? []
  const interior = waypoints.slice(1, -1)
  const points: Point[] = [
    { x: sourceX, y: sourceY },
    ...interior,
    { x: targetX, y: targetY },
  ]
  const path = roundedPath(points)

  const leaving = data?.leaving === true
  const enterDelay = (data?.enterDelay as number | undefined) ?? 0
  // On travel the edge draws itself in while keeping its own line style — a foreign key stays
  // solid, a view dependency dashed, a manual link dotted. Rather than sweeping the stroke's
  // own dash (which would flatten the pattern), a wide mask wipes along the path and uncovers
  // the edge beneath it end to end: `pathLength: 1` with `stroke-dasharray: 1` makes the mask
  // one full-length dash, so animating its offset from 1 to 0 reveals the line from source to
  // target. The mask stroke is wide enough to clear the arrowhead, and rests fully open under
  // a reduced-motion preference (the draw is disabled there). An edge leaving the view instead
  // fades out (`er-edge-leave`). The mask id is sanitised because an edge id carries dots and
  // colons.
  const maskId = `er-edge-mask-${id.replace(/[^\w-]/g, '_')}`
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const pad = 40
  // The reveal sweeps along the mask from its start. Normally that is the source end, which
  // is the centre for an edge pointing away from it; when the centre is instead the edge's
  // target (er-diagram.tsx flags this), reverse the mask geometry so the sweep still starts at
  // the centre and the line grows outward rather than towards it. Only the invisible mask is
  // reversed — the visible edge keeps its direction and arrowhead.
  const maskPath = data?.drawFromTarget === true ? roundedPath([...points].reverse()) : path
  const edgePath = leaving ? (
    <path
      className="react-flow__edge-path er-edge-leave"
      d={path}
      markerEnd={markerEnd}
      style={style}
    />
  ) : (
    <>
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x={Math.min(...xs) - pad}
        y={Math.min(...ys) - pad}
        width={Math.max(...xs) - Math.min(...xs) + pad * 2}
        height={Math.max(...ys) - Math.min(...ys) + pad * 2}
      >
        <path
          className="er-edge-draw-in"
          d={maskPath}
          fill="none"
          stroke="white"
          strokeWidth={32}
          strokeLinecap="round"
          pathLength={1}
          style={{ strokeDasharray: 1, animationDelay: `${enterDelay}ms` }}
        />
      </mask>
      <path
        className="react-flow__edge-path"
        d={path}
        markerEnd={markerEnd}
        style={style}
        mask={`url(#${maskId})`}
      />
    </>
  )

  // A manual relationship can be removed straight from the map: hovering its (thin, dotted)
  // line reveals a delete control at its midpoint. Foreign keys and view dependencies carry
  // no id and so no control.
  const manual = data?.manual === true
  const relationshipId = data?.relationshipId as string | undefined
  const onRemove = data?.onRemove as ((id: string) => void) | undefined
  const mid = points[Math.floor(points.length / 2)] ?? points[0]

  if (!manual || onRemove === undefined || relationshipId === undefined) {
    return edgePath
  }

  return (
    <>
      {edgePath}
      {/* A wide, invisible hit area so the thin dotted line is easy to hover. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{ pointerEvents: 'stroke' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          aria-label={t('relationships.remove')}
          title={t('relationships.remove')}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => onRemove(relationshipId)}
          className={cn(
            'nodrag nopan absolute flex size-5 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-opacity hover:bg-destructive/15 hover:text-destructive',
            hovered ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
          )}
          style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
        >
          <X className="size-3" />
        </button>
      </EdgeLabelRenderer>
    </>
  )
}
