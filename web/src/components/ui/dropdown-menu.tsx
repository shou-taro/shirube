import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

// A thin shadcn/ui-style wrapper over Radix's dropdown menu: Radix handles the
// accessibility (focus, keyboard navigation, dismissal), these components add the
// project's styling. Only the pieces the app uses are re-exported.

/** The menu root; wraps a trigger and its content. */
export const DropdownMenu = DropdownMenuPrimitive.Root

/** The control that opens the menu. Pass `asChild` to use a custom button. */
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

/**
 * The floating menu panel, rendered in a portal so it escapes overflow clipping
 * (e.g. a scrolling list). `sideOffset` lifts it clear of the trigger.
 */
export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-36 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

/**
 * A single menu row. `variant="destructive"` tints it for irreversible actions such
 * as delete.
 */
export function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  variant?: 'default' | 'destructive'
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
        'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        variant === 'destructive' &&
          'text-destructive focus:bg-destructive/10 focus:text-destructive',
        className,
      )}
      {...props}
    />
  )
}

/** A thin divider between groups of items. */
export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}
