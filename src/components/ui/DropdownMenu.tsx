import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import { DropdownMenu as RadixMenu } from 'radix-ui'
import { cn } from './cn'
import { floatingItem, floatingPanel } from './popover'

/** Menu root; control with `open`/`onOpenChange` or leave uncontrolled. */
export const DropdownMenu = RadixMenu.Root

/** Wrap the opening button (usually an IconButton) with `asChild`. */
export const DropdownMenuTrigger = RadixMenu.Trigger

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixMenu.Content>
>(function DropdownMenuContent(
  { className, sideOffset = 4, align = 'end', ...props },
  ref,
) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        className={cn(floatingPanel, 'min-w-44', className)}
        {...props}
      />
    </RadixMenu.Portal>
  )
})

export interface DropdownMenuItemProps extends ComponentPropsWithoutRef<
  typeof RadixMenu.Item
> {
  icon?: ReactNode
  /** `danger` for destructive actions such as delete. */
  tone?: 'default' | 'danger'
}

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  DropdownMenuItemProps
>(function DropdownMenuItem(
  { className, icon, tone = 'default', children, ...props },
  ref,
) {
  return (
    <RadixMenu.Item
      ref={ref}
      className={cn(
        floatingItem,
        tone === 'danger' && 'text-danger data-[highlighted]:bg-danger-soft',
        className,
      )}
      {...props}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      )}
      {children}
    </RadixMenu.Item>
  )
})

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return (
    <RadixMenu.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
    />
  )
}

export function DropdownMenuLabel({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <RadixMenu.Label
      className={cn('px-2.5 py-1.5 text-xs font-medium text-muted', className)}
    >
      {children}
    </RadixMenu.Label>
  )
}
