import { useSyncExternalStore } from 'react'

/**
 * Track whether a CSS media query currently matches, re-rendering when it changes.
 *
 * Backed by `matchMedia` through `useSyncExternalStore`, so a component reads the live
 * value and updates as the viewport crosses the query. The server snapshot is `false`
 * (shirube renders client-side, but this keeps the hook safe under any SSR).
 *
 * @param query - A media query string, e.g. `'(max-width: 899px)'`.
 * @returns Whether the query currently matches.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onStoreChange)
      return () => list.removeEventListener('change', onStoreChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
