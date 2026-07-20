import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ResizeHandle } from '@/components/ui/resize-handle'
import type { PaneSize } from '@/lib/panes'

const SIZE: PaneSize = { min: 100, max: 300, default: 200 }

function renderHandle(edge: 'left' | 'right', width = 200) {
  const onResize = vi.fn()
  const onDragChange = vi.fn()
  render(
    <ResizeHandle
      edge={edge}
      width={width}
      size={SIZE}
      onResize={onResize}
      onDragChange={onDragChange}
      label="Resize"
    />,
  )
  return { handle: screen.getByRole('separator'), onResize, onDragChange }
}

/** jsdom does not implement pointer capture; the handle calls it on every drag. */
function stubPointerCapture(element: HTMLElement): void {
  element.setPointerCapture = vi.fn()
}

function drag(handle: HTMLElement, fromX: number, toX: number): void {
  stubPointerCapture(handle)
  fireEvent.pointerDown(handle, { button: 0, clientX: fromX, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: toX, pointerId: 1 })
}

describe('dragging', () => {
  it('widens a right-docked pane as the pointer moves left', () => {
    const { handle, onResize } = renderHandle('left', 200)

    drag(handle, 500, 460)

    expect(onResize).toHaveBeenLastCalledWith(240)
  })

  it('widens a left-docked pane as the pointer moves right', () => {
    const { handle, onResize } = renderHandle('right', 200)

    drag(handle, 500, 540)

    expect(onResize).toHaveBeenLastCalledWith(240)
  })

  it('holds the width within its bounds', () => {
    const { handle, onResize } = renderHandle('right', 200)

    drag(handle, 500, 900)
    expect(onResize).toHaveBeenLastCalledWith(SIZE.max)

    drag(handle, 500, 100)
    expect(onResize).toHaveBeenLastCalledWith(SIZE.min)
  })

  it('reports when a drag starts and ends, so transitions can be suppressed', () => {
    const { handle, onDragChange } = renderHandle('left')

    stubPointerCapture(handle)
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 })
    expect(onDragChange).toHaveBeenLastCalledWith(true)

    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(onDragChange).toHaveBeenLastCalledWith(false)
  })

  it('ignores a non-primary button, so a right-click never starts a drag', () => {
    const { handle, onDragChange } = renderHandle('left')

    fireEvent.pointerDown(handle, { button: 2, clientX: 500, pointerId: 1 })

    expect(onDragChange).not.toHaveBeenCalled()
  })
})

describe('keyboard and reset', () => {
  it('moves the edge with the arrow keys, in the direction that widens', () => {
    const { handle, onResize } = renderHandle('left', 200)

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenLastCalledWith(216)

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith(184)
  })

  it('reverses the arrow directions for a left-docked pane', () => {
    const { handle, onResize } = renderHandle('right', 200)

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith(216)
  })

  it('restores the default width on Home and on a double-click', () => {
    const { handle, onResize } = renderHandle('left', 120)

    fireEvent.keyDown(handle, { key: 'Home' })
    expect(onResize).toHaveBeenLastCalledWith(SIZE.default)

    fireEvent.doubleClick(handle)
    expect(onResize).toHaveBeenLastCalledWith(SIZE.default)
  })
})

describe('accessibility', () => {
  it('exposes its current width and bounds as a separator', () => {
    const { handle } = renderHandle('left', 180)

    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', '180')
    expect(handle).toHaveAttribute('aria-valuemin', String(SIZE.min))
    expect(handle).toHaveAttribute('aria-valuemax', String(SIZE.max))
    expect(handle).toHaveAttribute('tabindex', '0')
  })
})
