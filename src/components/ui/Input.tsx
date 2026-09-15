import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { Search, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from './cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Decorative icon on the start side of the field. */
  startIcon?: ReactNode
  /** Content on the end side, such as a clear button or unit. */
  endSlot?: ReactNode
  /** Marks the field invalid; Field sets this automatically. */
  invalid?: boolean
}

// Built on the shared `.input` class in index.css (32 px, token border,
// primary focus ring, 16 px text on mobile to avoid iOS zoom).
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { startIcon, endSlot, invalid, className, ...props },
  ref,
) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      className={cn(
        'input',
        !!startIcon && 'ps-9',
        !!endSlot && 'pe-9',
        !startIcon && !endSlot && className,
      )}
      {...props}
    />
  )
  if (!startIcon && !endSlot) return input
  return (
    <div className={cn('relative', className)}>
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
  function SearchInput({ value, onValueChange, placeholder, ...props }, ref) {
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
        startIcon={<Search size={15} />}
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
