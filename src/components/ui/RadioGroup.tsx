import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import { RadioGroup as RadixRadioGroup } from 'radix-ui'
import { cn } from './cn'

export interface RadioGroupProps extends ComponentPropsWithoutRef<
  typeof RadixRadioGroup.Root
> {
  /** Marks the group invalid; Field sets this automatically. */
  invalid?: boolean
}

/** Radio group root; lay out `RadioGroupItem`s inside as a vertical stack. */
export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
  function RadioGroup({ invalid, className, ...props }, ref) {
    return (
      <RadixRadioGroup.Root
        ref={ref}
        aria-invalid={invalid || props['aria-invalid'] || undefined}
        className={cn('flex flex-col gap-2', className)}
        {...props}
      />
    )
  },
)

export interface RadioGroupItemProps extends ComponentPropsWithoutRef<
  typeof RadixRadioGroup.Item
> {
  /** Inline label; a radio item without one is rare but supported. */
  label?: ReactNode
}

/**
 * Radio dot on Radix: 20 px circle inside a 40/36 px row, monochrome checked
 * state matching Checkbox and Switch.
 */
export const RadioGroupItem = forwardRef<
  HTMLButtonElement,
  RadioGroupItemProps
>(function RadioGroupItem({ label, disabled, className, id, ...props }, ref) {
  const generatedId = useId()
  const itemId = id ?? generatedId
  const dot = (
    <RadixRadioGroup.Item
      ref={ref}
      id={itemId}
      disabled={disabled}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-bg transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-primary',
        className,
      )}
      {...props}
    >
      <RadixRadioGroup.Indicator className="h-2.5 w-2.5 rounded-full bg-primary" />
    </RadixRadioGroup.Item>
  )
  if (!label) return dot
  return (
    <span className="inline-flex h-10 items-center gap-2 md:h-9">
      {dot}
      <label
        htmlFor={itemId}
        className={cn(
          'text-sm leading-snug',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        )}
      >
        {label}
      </label>
    </span>
  )
})
