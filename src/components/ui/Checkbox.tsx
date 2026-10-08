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
  /**
   * wave-15-export-fields: `sm` is a 16 px box with 12 px label text in a
   * 28 px row, for dense checklists (the export dialog's column list), like
   * `size="sm"` buttons in tables and toolbars.
   */
  size?: 'md' | 'sm'
}

/**
 * Checkbox on Radix: 20 px box inside a 40/36 px row so the touch target
 * matches the other shared controls (`size="sm"`: 16 px in a 28 px row).
 * Checked state uses the monochrome primary token.
 */
export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  function Checkbox(
    { label, invalid, disabled, className, id, size = 'md', ...props },
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
          'control-invalid peer inline-flex shrink-0 items-center justify-center border bg-bg text-primary-contrast transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          size === 'sm' ? 'h-4 w-4 rounded' : 'h-5 w-5 rounded-md',
          'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
          className,
        )}
        {...props}
      >
        <RadixCheckbox.Indicator>
          <Check
            size={size === 'sm' ? 11 : 13}
            strokeWidth={3}
            aria-hidden="true"
          />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
    )
    if (!label) return box
    return (
      <span
        className={cn(
          'inline-flex items-center',
          size === 'sm' ? 'min-h-7 gap-1.5' : 'h-10 gap-2 md:h-9',
        )}
      >
        {box}
        <label
          htmlFor={checkboxId}
          className={cn(
            size === 'sm' ? 'text-xs leading-tight' : 'text-sm leading-snug',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          )}
        >
          {label}
        </label>
      </span>
    )
  },
)
