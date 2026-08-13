/** An on-map item — a node or an edge — that can be flagged as leaving the view. */
interface Transitionable {
  id: string
  data?: Record<string, unknown>
}

/**
 * Merge the neighbourhood being travelled to with the items leaving it, so the departing
 * ones can ease out before they go rather than vanishing the instant the layout swaps.
 *
 * Every item in `target` is kept as-is: a table shared with the previous view reappears at
 * its fresh position (and glides there), and a newly-related table enters. Anything in
 * `current` that `target` no longer holds is carried over once more — flagged
 * `leaving: true`, at the position it already occupies — so it can play its exit animation.
 * The caller drops the flagged items a beat later, once that animation has run, by rendering
 * `target` alone.
 *
 * Kept pure and separate from the diagram's timers so the merge itself can be tested.
 *
 * @param target - The items the view is settling to (the new neighbourhood).
 * @param current - The items currently on screen (the previous render).
 * @returns `target` followed by the leaving items, each flagged in its data.
 */
export function withLeaving<T extends Transitionable>(
  target: T[],
  current: T[],
): T[] {
  const targetIds = new Set(target.map((item) => item.id))
  const leaving = current
    .filter((item) => !targetIds.has(item.id))
    .map((item) => ({ ...item, data: { ...item.data, leaving: true } }) as T)
  return [...target, ...leaving]
}
