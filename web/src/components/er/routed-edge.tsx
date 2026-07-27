import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
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

  // A manual relationship can be removed straight from the map: hovering its (thin, dotted)
  // line reveals a delete control at its midpoint. Foreign keys and view dependencies carry
  // no id and so no control.
  const manual = data?.manual === true
  const relationshipId = data?.relationshipId as string | undefined
  const onRemove = data?.onRemove as ((id: string) => void) | undefined
  const mid = points[Math.floor(points.length / 2)] ?? points[0]

  if (!manual || onRemove === undefined || relationshipId === undefined) {
    return <BaseEdge path={path} markerEnd={markerEnd} style={style} />
  }

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} interactionWidth={0} />
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
