import { cn } from '@/lib/utils'

/**
 * The shirube logo mark.
 *
 * A small ER-style node graph with one node highlighted in the brand colour — the
 * "you are here" waypoint that captures shirube's idea of navigating a database like a
 * map. The outlined nodes and edges follow `currentColor` so the mark inherits the
 * surrounding text colour and adapts to light and dark themes; only the focus node is
 * fixed to the brand token.
 *
 * @param className - Extra classes, typically a size utility (defaults to `size-6`).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={cn('size-6', className)}
      role="img"
      aria-label="shirube"
    >
      {/* Edges first, so the node fills sit on top and hide the joins. */}
      <line x1="12" y1="16" x2="31" y2="11.5" />
      <line x1="12" y1="16" x2="16" y2="35" />
      <line x1="32.5" y1="12.5" x2="36" y2="33" />
      <line x1="16" y1="35" x2="36" y2="33" />
      {/* Outlined nodes: filled with the page background so edges are hidden behind. */}
      <circle cx="12" cy="16" r="4" fill="var(--background)" />
      <circle cx="16" cy="35" r="4" fill="var(--background)" />
      <circle cx="36" cy="33" r="4" fill="var(--background)" />
      {/* Focus node in the brand colour. */}
      <circle cx="32" cy="11" r="5.5" fill="var(--brand)" stroke="var(--brand)" />
    </svg>
  )
}
