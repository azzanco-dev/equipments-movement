import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react'
import { Tooltip as RadixTooltip } from 'radix-ui'
import { cn } from './cn'
import { floatingPanel } from './popover'

export interface TooltipProps {
  /** Text or short content shown in the floating bubble. */
  content: ReactNode
  /** A single focusable/hoverable element; must accept a ref. */
  children: ReactElement
  side?: ComponentPropsWithoutRef<typeof RadixTooltip.Content>['side']
  align?: ComponentPropsWithoutRef<typeof RadixTooltip.Content>['align']
  /** Hover/focus delay before the tooltip shows, in ms. */
  delayDuration?: number
  /** Renders the child with no tooltip wiring at all. */
  disabled?: boolean
  className?: string
}

/**
 * Simple hover/focus tooltip on Radix, with its own Provider so it works
 * without any app-level setup: <Tooltip content="...">{child}</Tooltip>.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  delayDuration = 300,
  disabled = false,
  className,
}: TooltipProps) {
  if (disabled || content == null || content === '') return children
  return (
    <RadixTooltip.Provider delayDuration={delayDuration}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            align={align}
            sideOffset={6}
            className={cn(
              floatingPanel,
              'max-w-64 px-2.5 py-1.5 text-xs leading-relaxed',
              className,
            )}
          >
            {content}
            <RadixTooltip.Arrow className="fill-bg" width={10} height={5} />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
