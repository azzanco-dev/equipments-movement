import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Slot } from 'radix-ui'
import { Loader2 } from 'lucide-react'
import { cn } from './cn'

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const base =
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-normal transition-colors duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-contrast hover:bg-primary-hover',
  outline: 'border bg-bg text-fg hover:bg-surface-hover',
  ghost: 'text-fg hover:bg-surface-hover',
  danger:
    'border border-transparent bg-danger-soft text-danger hover:border-danger',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-[13px]',
}

const iconSizes: Record<ButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
}

export function buttonClasses({
  variant = 'outline',
  size = 'md',
  iconOnly = false,
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  iconOnly?: boolean
  className?: string
} = {}) {
  return cn(
    base,
    variants[variant],
    iconOnly ? iconSizes[size] : sizes[size],
    className,
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner, disables the button, and keeps its width. */
  loading?: boolean
  /** Icon placed before the label (start side in RTL and LTR). */
  icon?: ReactNode
  /** Render the child element (for example a link) with button styles. */
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'outline',
      size = 'md',
      loading = false,
      icon,
      asChild = false,
      className,
      disabled,
      type,
      children,
      ...props
    },
    ref,
  ) {
    const classes = buttonClasses({ variant, size, className })
    if (asChild)
      return (
        <Slot.Root ref={ref} className={classes} {...props}>
          {children}
        </Slot.Root>
      )
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <Loader2 size={15} className="animate-spin" aria-hidden="true" />
        ) : (
          icon
        )}
        {children}
      </button>
    )
  },
)

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  /** Accessible name; icon-only buttons must always have one. */
  label: string
  icon: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { label, icon, variant = 'ghost', size = 'md', className, type, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        aria-label={label}
        title={label}
        className={buttonClasses({ variant, size, iconOnly: true, className })}
        {...props}
      >
        {icon}
      </button>
    )
  },
)
