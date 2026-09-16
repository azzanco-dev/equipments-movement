import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { Tabs as RadixTabs } from 'radix-ui'
import { cn } from './cn'

/** Tabs root; keyboard arrows follow the interface direction (RTL/LTR). */
export const Tabs = RadixTabs.Root

export type TabsVariant = 'underline' | 'segmented'

export interface TabsListProps extends ComponentPropsWithoutRef<
  typeof RadixTabs.List
> {
  /** `underline` for page sections, `segmented` for compact filters. */
  variant?: TabsVariant
}

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  function TabsList({ className, variant = 'underline', ...props }, ref) {
    return (
      <RadixTabs.List
        ref={ref}
        data-variant={variant}
        className={cn(
          'group/tabs flex max-w-full items-center overflow-x-auto',
          variant === 'underline'
            ? 'gap-4 border-b'
            : 'inline-flex w-fit gap-0.5 rounded-lg border bg-surface p-0.5',
          className,
        )}
        {...props}
      />
    )
  },
)

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <RadixTabs.Trigger
      ref={ref}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted transition-colors hover:text-fg disabled:pointer-events-none disabled:opacity-50',
        // underline
        'group-data-[variant=underline]/tabs:-mb-px group-data-[variant=underline]/tabs:border-b-2 group-data-[variant=underline]/tabs:border-transparent group-data-[variant=underline]/tabs:pb-2.5 group-data-[variant=underline]/tabs:pt-1',
        'group-data-[variant=underline]/tabs:data-[state=active]:border-fg group-data-[variant=underline]/tabs:data-[state=active]:font-semibold group-data-[variant=underline]/tabs:data-[state=active]:text-fg',
        // segmented
        'group-data-[variant=segmented]/tabs:h-8 group-data-[variant=segmented]/tabs:rounded-md group-data-[variant=segmented]/tabs:px-3',
        'group-data-[variant=segmented]/tabs:data-[state=active]:bg-bg group-data-[variant=segmented]/tabs:data-[state=active]:text-fg group-data-[variant=segmented]/tabs:data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  )
})

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <RadixTabs.Content
      ref={ref}
      className={cn('mt-4 outline-none', className)}
      {...props}
    />
  )
})
