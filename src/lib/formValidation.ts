import { z } from 'zod'
import type { TranslationKey } from '@/i18n/translations'
import { isValidUserMobile, normalizeUserMobileInput } from '@/lib/userMobile'

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

// ---------------------------------------------------------------------------
// wave 18 — Zod schemas (owner decision 2026-10-10)
//
// Every form's fields are described by one Zod schema whose messages are
// TRANSLATION KEYS, never text: `fieldErrorsFromZod` turns a failed
// `safeParse` into the same `FieldErrors` map the forms already render under
// each field and pass to `focusFirstError`. The rules stay lenient: required
// fields, obvious formats, and the lengths the database checks already
// enforce. An optional field that is left empty always passes.
// ---------------------------------------------------------------------------

/**
 * Mobile number rule of the driver records: digits only, 7 to 15 of them, with
 * an optional leading `+`. Mirrors `drivers_mobile_number_check`.
 */
export const MOBILE_NUMBER_PATTERN = /^\+?\d{7,15}$/

/** `drivers_id_number_check`: 5 to 20 digits. */
export const ID_NUMBER_PATTERN = /^\d{5,20}$/

/** A plausible email address, as the user dialogs checked before. */
export const EMAIL_PATTERN = /^\S+@\S+\.\S+$/

/** `drivers.full_name` / `drivers.name_en`: 2 to 150 characters once trimmed
 *  (`char_length(btrim(...)) BETWEEN 2 AND 150`, migrations 0033 and 0078). */
export const PERSON_NAME_MIN = 2
export const PERSON_NAME_MAX = 150

/** The years the equipment Excel import accepts (`parseEquipmentExcel`). */
export const MANUFACTURE_YEAR_MIN = 1900
export const MANUFACTURE_YEAR_MAX = 2100

/** The minimum the `create-user` / `manage-user` Edge Functions accept. */
export const PASSWORD_MIN_LENGTH = 8

/** A Zod message is always one of our translation keys. */
const message = (key: TranslationKey) => ({ message: key })

interface TextOptions {
  /** Shortest accepted trimmed length (default 1 for required text). */
  min?: number
  /** Longest accepted trimmed length. */
  max?: number
  /** Message for a value outside `min`..`max`. */
  lengthKey?: TranslationKey
}

const withinLength = (value: string, { min, max }: TextOptions) =>
  (min === undefined || value.length >= min) &&
  (max === undefined || value.length <= max)

/** Mandatory text: blank fails with `requiredKey`, then the length rule. */
export function requiredText(
  requiredKey: TranslationKey,
  options: TextOptions = {},
) {
  return z
    .string()
    .trim()
    .min(1, message(requiredKey))
    .refine(
      (value) => !value || withinLength(value, options),
      message(options.lengthKey ?? 'textTooLong'),
    )
}

/** Optional text: empty passes; a filled value must respect the length. */
export function optionalText(options: TextOptions = {}) {
  return z
    .string()
    .trim()
    .refine(
      (value) => !value || withinLength(value, options),
      message(options.lengthKey ?? 'textTooLong'),
    )
}

/** Optional (or, with `requiredKey`, mandatory) mobile number. */
export function mobileNumber(requiredKey?: TranslationKey) {
  const base = z.string().trim()
  return (requiredKey ? base.min(1, message(requiredKey)) : base).refine(
    (value) => !value || MOBILE_NUMBER_PATTERN.test(value),
    message('mobileNumberFormatInvalid'),
  )
}

/** Optional ID/iqama number: digits only, 5 to 20 of them. */
export function idNumber() {
  return z
    .string()
    .trim()
    .refine(
      (value) => !value || ID_NUMBER_PATTERN.test(value),
      message('idNumberFormatInvalid'),
    )
}

/**
 * A plate number as the plate input builds it: the digits are what makes it
 * a plate (letters are optional), so a plate without a digit is reported as
 * missing. Arabic letters and dashes are accepted as typed.
 */
export function plate() {
  return z
    .string()
    .refine((value) => /[0-9]/.test(value), message('plateRequired'))
}

/** A mandatory equipment code: any non-blank text (dashes, letters, digits). */
export function code(requiredKey: TranslationKey = 'equipmentCodeRequired') {
  return z.string().trim().min(1, message(requiredKey))
}

/** Optional four-digit year between `min` and `max`. */
export function year(min: number, max: number, key: TranslationKey) {
  return z
    .string()
    .trim()
    .refine(
      (value) =>
        !value ||
        (/^\d{4}$/.test(value) && Number(value) >= min && Number(value) <= max),
      message(key),
    )
}

/** A selection (id or option value) that must be made. */
export function selected(requiredKey: TranslationKey) {
  return z.string().trim().min(1, message(requiredKey))
}

/** The shape every Zod `safeParse` result has, whatever the schema. */
export type ZodParseResult =
  { success: true } | { success: false; error: z.ZodError }

/**
 * Turns a `safeParse` result into the per-field map the forms render: the
 * first issue of each top-level field wins, so the message shown is the first
 * rule that field broke (a blank required field says «مطلوب», not "too
 * short"). The map holds translation keys; the form translates them when it
 * renders, so a language switch re-renders the messages too. A Zod default
 * message (a value of the wrong type) falls back to the generic `required`.
 */
export function fieldErrorsFromZod<T>(result: ZodParseResult): FieldErrors<T> {
  if (result.success) return {}
  const errors: FieldErrors<T> = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof T | undefined
    if (field === undefined || errors[field]) continue
    errors[field] = (
      issue.code === z.ZodIssueCode.invalid_type ? 'required' : issue.message
    ) as TranslationKey
  }
  return errors
}

/** `fieldErrorsFromZod(schema.safeParse(values))` in one call. */
export function validateWithSchema<T>(
  schema: z.ZodTypeAny,
  values: T,
): FieldErrors<T> {
  return fieldErrorsFromZod<T>(schema.safeParse(values))
}

// --- One schema per form ---------------------------------------------------

/** Driver add/edit: only the full name is mandatory (AGENTS.md). */
export const driverFormSchema = z.object({
  full_name: requiredText('fullNameRequired', {
    min: PERSON_NAME_MIN,
    max: PERSON_NAME_MAX,
    lengthKey: 'nameLengthInvalid',
  }),
  name_en: optionalText({
    min: PERSON_NAME_MIN,
    max: PERSON_NAME_MAX,
    lengthKey: 'nameLengthInvalid',
  }),
  id_number: idNumber(),
  mobile_number: mobileNumber(),
})

/** Quick Create driver: the name and a valid mobile are both required. */
export const quickDriverFormSchema = z.object({
  fullName: requiredText('fullNameRequired', {
    min: PERSON_NAME_MIN,
    max: PERSON_NAME_MAX,
    lengthKey: 'nameLengthInvalid',
  }),
  mobile: mobileNumber('mobileNumberRequired'),
})

/**
 * Equipment add/edit: code, type and QR value are `NOT NULL`; a numbered unit
 * needs its plate; the optional manufacture year is a sensible year.
 */
export const equipmentFormSchema = z
  .object({
    code: code(),
    type: selected('equipmentTypeRequired'),
    numbering_status: z.string(),
    plate_number: z.string(),
    manufacture_year: year(
      MANUFACTURE_YEAR_MIN,
      MANUFACTURE_YEAR_MAX,
      'manufactureYearInvalid',
    ),
    qr_value: requiredText('qrValueRequired'),
  })
  .superRefine((form, context) => {
    if (form.numbering_status !== 'numbered') return
    const result = plate().safeParse(form.plate_number)
    if (!result.success)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plate_number'],
        message: result.error.issues[0].message,
      })
  })

/**
 * Quick Create equipment. The workshop panel asks for a code (when numbered)
 * and a plate; the foreman panel for a plate or a chassis number, plus the
 * type and the external supplier.
 */
export function quickEquipmentFormSchema(workshopMode: boolean) {
  return z
    .object({
      plate: z.string(),
      chassis: z.string(),
      identifierType: z.string(),
      code: z.string(),
      type: z.string(),
      lessorId: z.string(),
      numberingStatus: z.string(),
    })
    .superRefine((form, context) => {
      const add = (path: string, key: TranslationKey) =>
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: key,
        })
      if (
        workshopMode &&
        form.numberingStatus === 'numbered' &&
        !form.code.trim()
      )
        add('code', 'equipmentCodeRequired')
      const needsPlate = workshopMode || form.identifierType === 'plate'
      if (needsPlate && !plate().safeParse(form.plate).success)
        add('plate', 'plateRequired')
      if (workshopMode) return
      if (form.identifierType === 'chassis' && !form.chassis.trim())
        add('chassis', 'chassisNumberRequired')
      if (!form.type.trim()) add('type', 'equipmentTypeRequired')
      if (!form.lessorId.trim()) add('lessorId', 'lessorRequired')
    })
}

/** Companies: both names are `NOT NULL`. */
export const companyFormSchema = z.object({
  name_ar: requiredText('companyNameArRequired'),
  name_en: requiredText('companyNameEnRequired'),
})

/** Projects: both names are `NOT NULL`. */
export const projectFormSchema = z.object({
  name_ar: requiredText('projectNameArRequired'),
  name_en: requiredText('projectNameEnRequired'),
})

/**
 * External suppliers: only the name is mandatory. The contact number is free
 * text in the database (no check), so it stays unvalidated: existing numbers
 * written in other ways must keep saving.
 */
export const lessorFormSchema = z.object({
  name: requiredText('lessorNameRequired'),
})

/** Quick Create supplier: `quick_create_lessor_by_name` takes 150 characters. */
export const quickLessorFormSchema = z.object({
  name: requiredText('lessorNameRequired', {
    max: 150,
    lengthKey: 'lessorNameTooLong',
  }),
})

/** Equipment types (Settings): a non-blank name (`equipment_types` check). */
export const equipmentTypeFormSchema = z.object({
  name: requiredText('equipmentTypeRequired'),
})

const emailField = requiredText('emailRequired').refine(
  (value) => !value || EMAIL_PATTERN.test(value),
  message('invalidUserEmail'),
)

/** Add user: name, email and an initial password of at least 8 characters. */
export const userFormSchema = z.object({
  full_name: requiredText('fullNameRequired'),
  email: emailField,
  password: z
    .string()
    .min(1, message('passwordRequired'))
    .min(PASSWORD_MIN_LENGTH, message('passwordMinLength')),
})

/**
 * Edit user: the password is optional (blank keeps the current one), and the
 * optional mobile number follows `admin_set_user_mobile` (8 to 15 digits, an
 * optional `+`; spaces and dashes are typing aids it removes).
 */
export const userEditFormSchema = z.object({
  full_name: requiredText('fullNameRequired'),
  email: emailField,
  password: z
    .string()
    .refine(
      (value) => !value || value.length >= PASSWORD_MIN_LENGTH,
      message('passwordMinLength'),
    ),
  mobile_number: z
    .string()
    .refine(
      (value) => isValidUserMobile(normalizeUserMobileInput(value)),
      message('userMobileInvalid'),
    ),
})

/** Sign in: both fields present; the server decides whether they match. */
export const signInFormSchema = z.object({
  email: requiredText('emailRequired'),
  password: z.string().min(1, message('passwordRequired')),
})

/** First-login password change: 8 characters, typed the same twice. */
export const passwordChangeFormSchema = z
  .object({
    password: z
      .string()
      .min(1, message('passwordRequired'))
      .min(PASSWORD_MIN_LENGTH, message('passwordMinLength')),
    confirmation: z.string().min(1, message('passwordRequired')),
  })
  .superRefine((form, context) => {
    if (form.confirmation && form.password !== form.confirmation)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmation'],
        message: 'passwordsDoNotMatch',
      })
  })

/** Driver change during an open visit: the new driver must be chosen. */
export const driverChangeFormSchema = z.object({
  driver_id: selected('driverChangeDriverRequired'),
})

/** Workshop opening balance (Settings): the unit must be chosen. */
export const workshopOpeningFormSchema = z.object({
  equipment_id: selected('movementEditEquipmentRequired'),
})

export interface PostgresLikeError {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

/**
 * The kinds of database rejection a form can attribute to a field:
 * - `unique` (23505), `check` (23514), `foreignKey` (23503) and `notNull`
 *   (23502) carry the constraint/index or column name in their text;
 * - `tooLong` (22001) names no column, so its rule normally has no `match`;
 * - `raised` is one of our stable `RAISE EXCEPTION '<token>'` codes, matched
 *   by its token whatever SQLSTATE it was raised with.
 */
export type DatabaseErrorKind =
  'unique' | 'check' | 'foreignKey' | 'notNull' | 'tooLong' | 'raised'

const SQLSTATE_KINDS: Record<string, DatabaseErrorKind> = {
  '23505': 'unique',
  '23514': 'check',
  '23503': 'foreignKey',
  '23502': 'notNull',
  '22001': 'tooLong',
}

/** The constraint kind of a PostgreSQL error, or null for anything else. */
export function databaseErrorKind(
  error: PostgresLikeError | null | undefined,
): DatabaseErrorKind | null {
  if (!error?.code) return null
  return SQLSTATE_KINDS[error.code] ?? null
}

/**
 * One row of a form's database-error map: when the error is of kind `on` and
 * its text contains `match` (lowercased constraint/index name, column name,
 * or raised token), the message `key` goes under `field`. A rule without
 * `match` takes every error of its kind (meant for `tooLong`).
 */
export interface DatabaseFieldRule<T> {
  on: DatabaseErrorKind
  match?: string
  field: keyof T
  key: TranslationKey
}

function errorText(error: PostgresLikeError): string {
  return [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * Attributes a database rejection to the field that caused it. Raised tokens
 * are checked first (some are raised with a constraint SQLSTATE, such as
 * `equipment_code_previously_used` with 23505), then the rules of the error's
 * kind in the order given. Returns null when no rule applies: the caller then
 * shows its generic, safe form-level message. The raw database text is never
 * shown, only the matched translation key.
 */
export function mapDatabaseErrorToField<T>(
  error: PostgresLikeError | null | undefined,
  rules: readonly DatabaseFieldRule<T>[],
): FieldErrors<T> | null {
  if (!error) return null
  const text = errorText(error)
  for (const rule of rules)
    if (rule.on === 'raised' && rule.match && text.includes(rule.match))
      return { [rule.field]: rule.key } as FieldErrors<T>
  const kind = databaseErrorKind(error)
  if (!kind) return null
  for (const rule of rules)
    if (rule.on === kind && (!rule.match || text.includes(rule.match)))
      return { [rule.field]: rule.key } as FieldErrors<T>
  return null
}

/**
 * A unique-violation rule of the earlier forms: `mapDatabaseErrorToField`
 * restricted to `unique`.
 */
export interface DuplicateRule<T> {
  /** Lowercased fragment of the index/constraint name. */
  match: string
  field: keyof T
  key: TranslationKey
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
  return mapDatabaseErrorToField<T>(
    error,
    rules.map((rule) => ({ ...rule, on: 'unique' as const })),
  )
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
