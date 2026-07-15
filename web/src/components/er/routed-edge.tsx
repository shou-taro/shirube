import { BaseEdge, type EdgeProps } from '@xyflow/react'

/** A waypoint on a dagre-routed edge. */
interface Point {
  x: number
  y: number
}

const CORNER_RADIUS = 10

/**
 * Build an SVG path through the waypoints with rounded corners. Each interior point is
 * turned into a short arc so the polyline reads smoothly rather than as hard bends.
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

/** A point `distance` away from `from`, moving towards `to` (clamped to the segment). */
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
  const waypoints = (data?.points as Point[] | undefined) ?? []
  const interior = waypoints.slice(1, -1)
  const points: Point[] = [
    { x: sourceX, y: sourceY },
    ...interior,
    { x: targetX, y: targetY },
  ]
  return <BaseEdge path={roundedPath(points)} markerEnd={markerEnd} style={style} />
}
