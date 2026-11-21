import type { TranslationKey } from '@/i18n/translations'

/**
 * A message handed from one installments page to the page it opens (a new
 * contract opens its page; a deleted contract opens the list). The router
 * remounts the app on every path change, so the first page's own Toast
 * provider goes with it; the message waits here, in the module, for the
 * next page to show it once.
 */
export interface InstallmentFlash {
  message: TranslationKey
  tone: 'success' | 'warning'
}

let pending: InstallmentFlash | null = null

export function setInstallmentFlash(
  message: TranslationKey,
  tone: InstallmentFlash['tone'] = 'success',
) {
  pending = { message, tone }
}

/** The waiting message, taken (a second call returns null). */
export function takeInstallmentFlash(): InstallmentFlash | null {
  const flash = pending
  pending = null
  return flash
}
