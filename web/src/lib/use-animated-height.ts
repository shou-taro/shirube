import { useLayoutEffect, useRef } from 'react'

const DURATION_MS = 320
// A little longer than the transition, to release the pinned height even if `transitionend`
// never arrives (an interrupted or paused transition), so the wrapper is never left stuck.
const SETTLE_FALLBACK_MS = 400

/**
 * Animate an element's height between layouts when `dependency` changes.
 *
 * Attach the returned ref to a wrapper whose children swap for a set of a different height —
 * a form whose fields depend on a chosen engine or provider, say. When `dependency` changes,
 * the wrapper eases from its old height to its new one rather than jumping; everything below
 * it (and any auto-height ancestor) follows. The wrapper is clipped and pinned to a pixel
 * height only for the duration of the transition, then released back to `auto`, so nothing is
 * left stuck at a stale height and normal reflow resumes.
 *
 * Reduced motion is honoured for free: the global net collapses the transition, so the height
 * simply snaps.
 *
 * @param dependency - The value whose change triggers a re-measure and animation.
 * @returns A ref to place on the wrapper element.
 */
export function useAnimatedHeight<T extends HTMLElement = HTMLDivElement>(dependency: unknown) {
  const ref = useRef<T>(null)
  const previousHeight = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const target = el.scrollHeight
    // First render: record the height without animating from nothing.
    if (previousHeight.current === null) {
      previousHeight.current = target
      return
    }
    const from = previousHeight.current
    previousHeight.current = target
    if (from === target) return

    el.style.overflow = 'hidden'
    el.style.height = `${from}px`
    void el.offsetHeight // Flush the start height so the transition has a frame to run from.
    el.style.transition = `height ${DURATION_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`
    el.style.height = `${target}px`

    let timer: ReturnType<typeof setTimeout>
    const settle = (event?: TransitionEvent): void => {
      if (event && event.propertyName !== 'height') return
      el.style.transition = ''
      el.style.height = 'auto'
      el.style.overflow = ''
      el.removeEventListener('transitionend', settle)
      clearTimeout(timer)
    }
    el.addEventListener('transitionend', settle)
    timer = setTimeout(settle, SETTLE_FALLBACK_MS)
    return () => settle()
  }, [dependency])

  return ref
}
