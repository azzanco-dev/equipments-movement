import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import { Switch as RadixSwitch } from 'radix-ui'
import { cn } from './cn'

export interface SwitchProps extends ComponentPropsWithoutRef<
  typeof RadixSwitch.Root
> {
  /**
   * Inline label for standalone use. When used inside `Field`, omit this and
   * let Field's own label (linked to the same id) describe the control, so
   * the switch is not labelled twice.
   */
  label?: ReactNode
  /** Marks the control invalid; Field sets this automatically. */
  invalid?: boolean
}

/**
 * Switch on Radix: a 20 px tall track inside a 40/36 px row. The thumb
 * position is set by `.switch-thumb` in index.css so it flips correctly in
 * RTL (a plain `translate-x` would not reverse with direction).
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch({ label, invalid, disabled, className, id, ...props }, ref) {
    const generatedId = useId()
    const switchId = id ?? generatedId
    const track = (
      <RadixSwitch.Root
        ref={ref}
        id={switchId}
        disabled={disabled}
        aria-invalid={invalid || props['aria-invalid'] || undefined}
        className={cn(
          'control-invalid inline-flex h-5 w-9 shrink-0 items-center rounded-full border bg-surface p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
          className,
        )}
        {...props}
      >
        <RadixSwitch.Thumb className="switch-thumb block h-3.5 w-3.5 rounded-full bg-bg shadow-sm transition-transform duration-150" />
      </RadixSwitch.Root>
    )
    if (!label) return track
    return (
      <span className="inline-flex h-10 items-center gap-2 md:h-9">
        {track}
        <label
          htmlFor={switchId}
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
