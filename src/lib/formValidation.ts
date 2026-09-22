import type { TranslationKey } from '@/i18n/translations'

/**
 * Per-field validation messages for one form: the field name maps to the
 * translation key of its message. A form with no problems returns `{}`.
 *
 * Validation runs on submit only; a field's entry is dropped as soon as the
 * user edits it (`clearFieldErrors`). No rule here is new: every message
 * mirrors a rule the form already enforced, a database check/constraint, or a
 * field the form already marks as required.
 */
export type FieldErrors<T> = Partial<Record<keyof T, TranslationKey>>

/**
 * Builds a `FieldErrors` from one entry per rule, dropping the fields that
 * passed, so a valid form is exactly `{}`.
 */
export function fieldErrors<T>(entries: {
  [K in keyof T]?: TranslationKey | undefined
}): FieldErrors<T> {
  const result: FieldErrors<T> = {}
  for (const [field, key] of Object.entries(entries) as [
    keyof T,
    TranslationKey | undefined,
  ][])
    if (key) result[field] = key
  return result
}

/** True when at least one field carries a message. */
export function hasErrors<T>(errors: FieldErrors<T>): boolean {
  return Object.values(errors).some(Boolean)
}

/**
 * The first field with a message, following the visual order of the form, so
 * the form can focus and scroll to the problem the user sees first.
 */
export function firstErrorField<T>(
  errors: FieldErrors<T>,
  order: readonly (keyof T)[],
): keyof T | null {
  for (const field of order) if (errors[field]) return field
  return null
}

/**
 * Drops the messages of the fields the user just edited, leaving the rest in
 * place. Returns the same object when nothing changes, so React does not
 * re-render for an untouched error state.
 */
export function clearFieldErrors<T>(
  errors: FieldErrors<T>,
  fields: readonly (keyof T)[],
): FieldErrors<T> {
  if (!fields.some((field) => errors[field])) return errors
  const next = { ...errors }
  for (const field of fields) delete next[field]
  return next
}

/** A value that is missing or blank fails; everything else passes. */
export function required(
  value: string | null | undefined,
  key: TranslationKey,
): TranslationKey | undefined {
  return value && value.trim() ? undefined : key
}

/**
 * Format check for an optional field: an empty value passes, so validation
 * never asks for more than the form asked for before.
 */
export function pattern(
  value: string | null | undefined,
  expression: RegExp,
  key: TranslationKey,
): TranslationKey | undefined {
  if (!value || !value.trim()) return undefined
  return expression.test(value.trim()) ? undefined : key
}

/** `pattern` for the "digits only, between min and max" database checks. */
export function digitsRange(
  value: string | null | undefined,
  min: number,
  max: number,
  key: TranslationKey,
): TranslationKey | undefined {
  return pattern(value, new RegExp(`^\\d{${min},${max}}$`), key)
}

/**
 * Maps a unique-violation to the field that owns it by matching the index or
 * constraint name PostgreSQL reports. The raw message is never shown; only the
 * matched translation key is.
 */
export interface DuplicateRule<T> {
  /** Lowercased fragment of the index/constraint name. */
  match: string
  field: keyof T
  key: TranslationKey
}

export interface PostgresLikeError {
  code?: string | null
  message?: string | null
  details?: string | null
}

/**
 * Returns the field errors for a known duplicate, or `null` when the error is
 * not a duplicate this form can attribute — the caller then shows its
 * top-level safe message.
 */
export function duplicateFieldErrors<T>(
  error: PostgresLikeError | null | undefined,
  rules: readonly DuplicateRule<T>[],
): FieldErrors<T> | null {
  if (!error || error.code !== '23505') return null
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  for (const rule of rules)
    if (text.includes(rule.match))
      return { [rule.field]: rule.key } as FieldErrors<T>
  return null
}

const FOCUSABLE =
  'input:not([type="hidden"]), select, textarea, button, [tabindex]:not([tabindex="-1"])'

/**
 * Focuses the first control inside the `data-field` container and scrolls it
 * into view. Returns false when the field is not on screen yet (a step that
 * still has to render).
 */
export function focusFieldControl(
  name: string,
  root?: ParentNode | null,
): boolean {
  if (typeof document === 'undefined') return false
  const scope = root ?? document
  const container = scope.querySelector<HTMLElement>(
    `[data-field="${CSS.escape(name)}"]`,
  )
  if (!container) return false
  const control = container.querySelector<HTMLElement>(FOCUSABLE) ?? container
  control.focus({ preventScroll: true })
  container.scrollIntoView({ block: 'center' })
  return true
}

export interface FocusFirstErrorOptions<T> {
  /** Limits the lookup to one form when several are mounted. */
  root?: ParentNode | null
  /** Runs before focusing, e.g. to switch to the step holding the field. */
  beforeFocus?: (field: keyof T) => void
}

/**
 * Focuses and scrolls to the first invalid field after the messages render.
 * A second frame covers a field that only appears once `beforeFocus` switched
 * the form to another step.
 */
export function focusFirstError<T>(
  errors: FieldErrors<T>,
  order: readonly (keyof T)[],
  options: FocusFirstErrorOptions<T> = {},
): void {
  const field = firstErrorField(errors, order)
  if (field === null) return
  options.beforeFocus?.(field)
  const focus = () => focusFieldControl(String(field), options.root)
  if (typeof window === 'undefined' || !window.requestAnimationFrame) {
    focus()
    return
  }
  window.requestAnimationFrame(() => {
    if (!focus()) window.requestAnimationFrame(focus)
  })
}
