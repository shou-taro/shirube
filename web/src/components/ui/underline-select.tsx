import { ChevronDown } from 'lucide-react'
import type { SelectHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/**
 * A native `<select>` styled as a minimal underlined control: a single bottom border rather
 * than a box, matching the modern connection and settings forms. The native appearance is
 * stripped (`appearance-none`) so the underline has straight, square ends rather than the
 * rounded ones a native select draws; a custom chevron restores the dropdown affordance the
 * stripped appearance would otherwise remove. Forwards every native select prop.
 */
export function UnderlineSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          'h-10 w-full appearance-none border-0 border-b border-input bg-transparent pl-1 pr-6 text-sm focus-visible:border-brand focus-visible:outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}
