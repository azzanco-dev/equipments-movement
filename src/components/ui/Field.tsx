import { useId, type ReactNode } from 'react'
import { Label } from 'radix-ui'
import { AlertCircle } from 'lucide-react'
import { cn } from './cn'

/** Props a Field passes to its control so label, hint, and error are wired. */
export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  invalid?: boolean
  /** aria-required, not `required`, so native browser validation bubbles do
   * not replace the forms' own validation messages. */
  'aria-required'?: boolean
}

export interface FieldProps {
  label: ReactNode
  /** Help text shown under the control. */
  hint?: ReactNode
  /** Validation message; also marks the control invalid. */
  error?: ReactNode
  required?: boolean
  className?: string
  children: (control: FieldControlProps) => ReactNode
}

/**
 * Label + control + hint/error, linked for screen readers.
 *
 * <Field label="..." error={error}>{(control) => <Input {...control} />}</Field>
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('min-w-0', className)}>
      <Label.Root htmlFor={id} className="label">
        {label}
        {required && (
          <span aria-hidden="true" className="ms-0.5 text-danger">
            *
          </span>
        )}
      </Label.Root>
      {children({
        id,
        'aria-describedby': describedBy,
        invalid: !!error,
        'aria-required': required || undefined,
      })}
      {error ? (
        <p
          id={errorId}
          className="mt-1 flex items-center gap-1 text-xs text-danger"
        >
          <AlertCircle size={13} aria-hidden="true" className="shrink-0" />
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
