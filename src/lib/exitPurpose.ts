import type { TranslationKey } from '@/i18n/translations'
import type { FilterField } from '@/components/data-list/types'

// wave-10-exit-purpose (migration 0111): the purpose of a SITE exit. The
// values are the allowlist of the database CHECK; the API rejects anything
// else and the form offers exactly these, with no default selection.

export const EXIT_PURPOSES = ['maintenance', 'work_completed'] as const

export type ExitPurpose = (typeof EXIT_PURPOSES)[number]

export const EXIT_PURPOSE_LABEL_KEYS: Record<ExitPurpose, TranslationKey> = {
  maintenance: 'exitPurposeMaintenance',
  work_completed: 'exitPurposeWorkCompleted',
}

export function isExitPurpose(value: unknown): value is ExitPurpose {
  return (
    typeof value === 'string' &&
    (EXIT_PURPOSES as readonly string[]).includes(value)
  )
}

/** Translation key of a stored purpose; `null` for a legacy row or a bad value. */
export function exitPurposeLabelKey(value: unknown): TranslationKey | null {
  return isExitPurpose(value) ? EXIT_PURPOSE_LABEL_KEYS[value] : null
}

// wave-12-exit-purpose: the purpose in the lists, filters and exports. Pure, so
// the list modules and their tests can import it without React.

/** A stored purpose, or `null` for a legacy row, an entry or a bad value. */
export function exitPurposeOrNull(value: unknown): ExitPurpose | null {
  return isExitPurpose(value) ? value : null
}

/**
 * The spreadsheet cell of a purpose: the localized words, or an empty cell
 * (never a dash) when the row has none, so the column still sorts and filters.
 */
export function exitPurposeExportLabel(
  value: unknown,
  t: (key: TranslationKey) => string,
): string {
  const key = exitPurposeLabelKey(value)
  return key ? t(key) : ''
}

/**
 * The «غرض الخروج» filter of the admin log (movements and visits views). The
 * key is a column of both `movement_log_search` and `movement_visits`
 * (migration 0118); the options are exactly `EXIT_PURPOSES`, and each config
 * allowlists the key before it reaches PostgREST.
 */
export const EXIT_PURPOSE_FILTER_FIELD: FilterField = {
  key: 'exit_purpose',
  label: 'exitPurpose',
  type: 'select',
  operators: ['eq'],
  options: [
    {
      value: 'maintenance',
      label: 'للصيانة',
      labelI18n: 'exitPurposeMaintenance',
    },
    {
      value: 'work_completed',
      label: 'انتهاء عمل',
      labelI18n: 'exitPurposeWorkCompleted',
    },
  ],
}
