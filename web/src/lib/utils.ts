import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names, resolving conflicting Tailwind utilities.
 *
 * `clsx` flattens conditional, array and object class inputs into a string, then
 * `tailwind-merge` de-duplicates clashing Tailwind classes so the last one wins
 * (e.g. `cn('p-2', 'p-4')` yields `'p-4'`). This is the standard shadcn/ui helper and
 * is what lets components accept a `className` override that reliably takes precedence.
 *
 * @param inputs - Class values: strings, arrays, or conditional objects.
 * @returns The merged, conflict-free class string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
