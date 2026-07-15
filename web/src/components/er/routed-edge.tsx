import { BaseEdge, type EdgeProps } from '@xyflow/react'

/** A waypoint on a dagre-routed edge. */
interface Point {
  x: number
  y: number
}

/**
 * Build a smooth SVG path through the waypoints using a Catmull-Rom spline converted to
 * cubic béziers. The curve passes through every point but rounds the bends, so the
 * dagre-routed edge reads as a flowing line rather than a chain of hard corners.
 */
function smoothPath(points: Point[]): string {
  if (points.length < 2) {
    return ''
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  }
  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    path += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`
  }
  return path
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
  return <BaseEdge path={smoothPath(points)} markerEnd={markerEnd} style={style} />
}
