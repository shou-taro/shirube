import type { LucideIcon } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * A text input in the app's modern form style: a taller, softly rounded field with an
 * optional leading icon that names it at a glance (a server for a host, a key for a secret,
 * and so on). Forwards every native input prop, so it drops in wherever a bare {@link Input}
 * was used; `wrapperClassName` styles the positioning wrapper (e.g. `flex-1` in a row).
 */
export function IconInput({
  icon: Icon,
  className,
  wrapperClassName,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { icon?: LucideIcon; wrapperClassName?: string }) {
  return (
    <div className={cn('relative', wrapperClassName)}>
      {Icon ? (
        <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      ) : null}
      <Input className={cn('h-10 rounded-lg', Icon ? 'pl-9' : null, className)} {...props} />
    </div>
  )
}
