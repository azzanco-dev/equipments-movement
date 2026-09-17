import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import { Checkbox as RadixCheckbox } from 'radix-ui'
import { Check } from 'lucide-react'
import { cn } from './cn'

export interface CheckboxProps extends Omit<
  ComponentPropsWithoutRef<typeof RadixCheckbox.Root>,
  'children'
> {
  /**
   * Inline label for standalone use. When used inside `Field`, omit this and
   * let Field's own label (linked to the same id) describe the control, so
   * the checkbox is not labelled twice.
   */
  label?: ReactNode
  /** Marks the control invalid; Field sets this automatically. */
  invalid?: boolean
}

/**
 * Checkbox on Radix: 20 px box inside a 40/36 px row so the touch target
 * matches the other shared controls. Checked state uses the monochrome
 * primary token.
 */
export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  function Checkbox(
    { label, invalid, disabled, className, id, ...props },
    ref,
  ) {
    const generatedId = useId()
    const checkboxId = id ?? generatedId
    const box = (
      <RadixCheckbox.Root
        ref={ref}
        id={checkboxId}
        disabled={disabled}
        aria-invalid={invalid || props['aria-invalid'] || undefined}
        className={cn(
          'control-invalid peer inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border bg-bg text-primary-contrast transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
          className,
        )}
        {...props}
      >
        <RadixCheckbox.Indicator>
          <Check size={13} strokeWidth={3} aria-hidden="true" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
    )
    if (!label) return box
    return (
      <span className="inline-flex h-10 items-center gap-2 md:h-9">
        {box}
        <label
          htmlFor={checkboxId}
          className={cn(
            'text-sm leading-snug',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          )}
        >
          {label}
        </label>
      </span>
    )
  },
)
