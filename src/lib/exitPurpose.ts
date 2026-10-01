import type { TranslationKey } from '@/i18n/translations'

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
