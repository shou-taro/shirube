import { type KeyboardEvent, type PointerEvent, useCallback } from 'react'

import { clampPaneWidth, type PaneSize } from '@/lib/panes'
import { cn } from '@/lib/utils'

/** How far one arrow-key press moves the edge, in pixels. */
const KEYBOARD_STEP = 16

interface ResizeHandleProps {
  /** Which edge of the pane the handle sits on — it decides which way a drag widens. */
  edge: 'left' | 'right'
  /** The pane's current width, in pixels. */
  width: number
  /** The width bounds and the default this handle resets to. */
  size: PaneSize
  /** Report a new width; already held within `size`. */
  onResize: (width: number) => void
  /** Called while a drag is in progress, so the owner can suppress width transitions. */
  onDragChange?: (dragging: boolean) => void
  /** Accessible name, e.g. "Resize the navigator". */
  label: string
  className?: string
}

/**
 * A draggable edge that resizes the pane it sits on.
 *
 * Pointer capture keeps the drag with this element even when the cursor outruns it, so the
 * edge follows the pointer rather than sticking. It is also a real
 * [separator](https://w3c.github.io/aria/#separator) — focusable, moved with the arrow keys
 * and reset with Home — because a drag-only control is unusable without a pointer. A
 * double-click resets to the default width, the usual shortcut for the same thing.
 */
export function ResizeHandle({
  edge,
  width,
  size,
  onResize,
  onDragChange,
  label,
  className,
}: ResizeHandleProps) {
  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>): void => {
      // Ignore anything but a primary-button drag, so a right-click never starts one.
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      const startX = event.clientX
      const startWidth = width
      const element = event.currentTarget
      element.setPointerCapture(event.pointerId)
      onDragChange?.(true)

      const onMove = (move: globalThis.PointerEvent): void => {
        // A handle on the left edge widens as the pointer moves left, and vice versa.
        const delta = edge === 'left' ? startX - move.clientX : move.clientX - startX
        onResize(clampPaneWidth(startWidth + delta, size))
      }
      const onUp = (): void => {
        element.removeEventListener('pointermove', onMove)
        element.removeEventListener('pointerup', onUp)
        element.removeEventListener('pointercancel', onUp)
        onDragChange?.(false)
      }
      element.addEventListener('pointermove', onMove)
      element.addEventListener('pointerup', onUp)
      element.addEventListener('pointercancel', onUp)
    },
    [edge, width, size, onResize, onDragChange],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      // Arrow keys move the edge itself, so which key widens depends on the side it is on.
      const towardsWider = edge === 'left' ? 'ArrowLeft' : 'ArrowRight'
      const towardsNarrower = edge === 'left' ? 'ArrowRight' : 'ArrowLeft'
      if (event.key === towardsWider) {
        event.preventDefault()
        onResize(clampPaneWidth(width + KEYBOARD_STEP, size))
      } else if (event.key === towardsNarrower) {
        event.preventDefault()
        onResize(clampPaneWidth(width - KEYBOARD_STEP, size))
      } else if (event.key === 'Home') {
        event.preventDefault()
        onResize(size.default)
      }
    },
    [edge, width, size, onResize],
  )

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={size.min}
      aria-valuemax={size.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onResize(size.default)}
      className={cn(
        // Sits just inside the edge rather than straddling it, so a pane that clips its
        // content (for rounded corners) does not clip the handle away.
        'group absolute inset-y-0 z-20 w-1.5 cursor-col-resize touch-none',
        'focus-visible:outline-none',
        edge === 'left' ? 'left-0' : 'right-0',
        className,
      )}
    >
      {/* A hairline that only shows on hover, drag or focus — the handle itself stays
          invisible so it does not read as a border. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-brand opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-100 group-active:opacity-100"
      />
    </div>
  )
}
