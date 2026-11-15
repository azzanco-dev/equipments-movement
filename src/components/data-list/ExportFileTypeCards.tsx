import type { ReactNode } from 'react'
import { RadioGroup as RadixRadioGroup } from 'radix-ui'
import { cn } from '@/components/ui/cn'

export interface RadioCardProps {
  value: string
  icon: ReactNode
  title: ReactNode
  hint: ReactNode
  disabled?: boolean
}

/**
 * A selectable card on the Radix radio group: the whole card is the radio, so
 * arrow keys, focus and screen readers behave as for a plain radio list. The
 * selected card has a 1.5 px primary border and a success-toned icon tile.
 */
export function RadioCard({
  value,
  icon,
  title,
  hint,
  disabled,
}: RadioCardProps) {
  return (
    <RadixRadioGroup.Item
      value={value}
      disabled={disabled}
      className={cn(
        // The approved Figma card: the icon tile and the radio on one row, the
        // name and its line under them.
        'group flex w-full flex-col gap-2.5 rounded-lg border bg-bg p-3 text-start transition-colors',
        'hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-[1.5px] data-[state=checked]:border-primary',
      )}
    >
      <span className="flex w-full items-center justify-between">
        <span
          aria-hidden="true"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-muted group-data-[state=checked]:bg-success-soft group-data-[state=checked]:text-success"
        >
          {icon}
        </span>
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-bg group-data-[state=checked]:border-primary"
        >
          <RadixRadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </RadixRadioGroup.Item>
  )
}

export interface RadioCardGroupProps {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  'aria-labelledby'?: string
  children: ReactNode
}

/** The group holding the cards: two columns from `sm`, stacked on a phone. */
export function RadioCardGroup({ children, ...props }: RadioCardGroupProps) {
  return (
    <RadixRadioGroup.Root
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      {...props}
    >
      {children}
    </RadixRadioGroup.Root>
  )
}
