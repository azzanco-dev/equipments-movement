import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { Search, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from './cn'

export type InputSize = 'md' | 'sm'

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size'
> {
  /**
   * Field height. `md` (default) is the approved 40 px on mobile / 36 px from
   * md; `sm` is the 32 px of the legacy toolbar buttons, for the compact
   * toolbars of the embedded lists. Replaces the native `size` attribute,
   * which no shared field uses.
   */
  size?: InputSize
  /** Decorative icon on the start side of the field. */
  startIcon?: ReactNode
  /** Content on the end side, such as a clear button or unit. */
  endSlot?: ReactNode
  /** Marks the field invalid; Field sets this automatically. */
  invalid?: boolean
}

// Built on the shared `.input` class in index.css (token border, primary focus
// ring, 16 px text on mobile to avoid iOS zoom). Shared inputs match the
// approved button height: 40 px on mobile, 36 px from md; legacy `.input`
// fields stay 32 px until their screens are migrated.
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { startIcon, endSlot, invalid, className, size = 'md', ...props },
  ref,
) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      className={cn(
        'input',
        size === 'sm' ? 'h-8 py-1 text-sm' : 'h-10 md:h-9',
        !!startIcon && 'ps-9',
        !!endSlot && 'pe-9',
        !startIcon && !endSlot && className,
      )}
      {...props}
    />
  )
  if (!startIcon && !endSlot) return input
  // The wrapper takes the field's `dir` too, so the icon (start-3) and the
  // end slot (end-1) sit on the same sides as the field's own padding when a
  // field is forced LTR inside the RTL page (the equipment code search).
  return (
    <div className={cn('relative', className)} dir={props.dir}>
      {startIcon && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted"
        >
          {startIcon}
        </span>
      )}
      {input}
      {endSlot && (
        <span className="absolute end-1 top-1/2 -translate-y-1/2">
          {endSlot}
        </span>
      )}
    </div>
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ invalid, className, rows = 3, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={invalid || props['aria-invalid'] || undefined}
        className={cn('input h-auto min-h-20 resize-y py-2', className)}
        {...props}
      />
    )
  },
)

export interface SearchInputProps extends Omit<
  InputProps,
  'value' | 'onChange' | 'type' | 'startIcon'
> {
  value: string
  onValueChange: (value: string) => void
}

/** Controlled search box with a search icon and a clear button. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    { value, onValueChange, placeholder, size, ...props },
    ref,
  ) {
    const { t } = useI18n()
    return (
      <Input
        ref={ref}
        type="search"
        role="searchbox"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder ?? t('search')}
        aria-label={props['aria-label'] ?? placeholder ?? t('search')}
        size={size}
        startIcon={<Search size={size === 'sm' ? 14 : 15} />}
        endSlot={
          value ? (
            <button
              type="button"
              onClick={() => onValueChange('')}
              aria-label={t('clear')}
              title={t('clear')}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-fg"
            >
              <X size={14} />
            </button>
          ) : undefined
        }
        {...props}
      />
    )
  },
)
