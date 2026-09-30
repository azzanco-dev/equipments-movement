// Named FloatingPopover.tsx (not Popover.tsx) only because this directory
// already has a lowercase popover.ts (shared floating-panel style tokens);
// the two names collide on a case-insensitive filesystem. The exported
// symbols below are still the intended public API: Popover, PopoverTrigger,
// PopoverContent, etc.
import {
  createContext,
  forwardRef,
  useContext,
  type ComponentPropsWithoutRef,
} from 'react'
import { Popover as RadixPopover } from 'radix-ui'
import { cn } from './cn'
import { floatingPanel } from './popover'

/**
 * Where popovers opened inside a modal are portaled.
 *
 * A Radix Dialog locks scrolling for everything outside its content. A
 * popover portaled to `<body>` sits outside it, so its list received no wheel
 * or touch scrolling. `Dialog` provides its content element here and the
 * popover portals into it instead; outside a dialog the value is `null` and
 * the popover keeps portaling to `<body>`.
 */
export const PopoverContainerContext = createContext<HTMLElement | null>(null)

/** Popover root; control with `open`/`onOpenChange` or leave uncontrolled. */
export const Popover = RadixPopover.Root

/** Wrap the opening control (usually a Button or the field trigger) with
 * `asChild`. */
export const PopoverTrigger = RadixPopover.Trigger

export const PopoverAnchor = RadixPopover.Anchor

export const PopoverClose = RadixPopover.Close

export const PopoverContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixPopover.Content>
>(function PopoverContent(
  {
    className,
    sideOffset = 4,
    align = 'start',
    collisionPadding = 8,
    ...props
  },
  ref,
) {
  const container = useContext(PopoverContainerContext)
  return (
    <RadixPopover.Portal container={container ?? undefined}>
      <RadixPopover.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={collisionPadding}
        // No default width: floatingPanel does not set one, so callers can
        // size content freely without fighting a base class (this file only
        // uses plain string concatenation, not a Tailwind class merger).
        // Radix already returns focus to the trigger on close and closes on
        // Escape, so no extra wiring is needed here.
        className={cn(floatingPanel, className)}
        {...props}
      />
    </RadixPopover.Portal>
  )
})
