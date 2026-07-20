/**
 * How wide the two side panes may be.
 *
 * Both are resizable because their content does not fit one fixed width: the detail card
 * holds column names and types that truncate, and the navigator renders answers containing
 * tables that would otherwise scroll sideways. The bounds keep a drag useful — never so
 * narrow the pane is unreadable, nor so wide it crowds out the map between them.
 */

/** The width bounds and starting width of one resizable pane, in pixels. */
export interface PaneSize {
  min: number
  max: number
  default: number
}

/** The floating table-detail card on the left. */
export const DETAIL_PANE: PaneSize = { min: 200, max: 480, default: 256 }

/** The AI navigator pane on the right. */
export const NAVIGATOR_PANE: PaneSize = { min: 240, max: 560, default: 288 }

/** Hold a width within a pane's bounds. */
export function clampPaneWidth(width: number, size: PaneSize): number {
  return Math.min(size.max, Math.max(size.min, Math.round(width)))
}
