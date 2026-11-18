import type { TranslationKey } from '@/i18n/translations'

/**
 * A success message handed from the list page to the contract page it opens
 * (a new contract opens its page). The router remounts the app on every
 * path change, so the list page's own Toast provider goes with it; the
 * message waits here, in the module, for the next page to show it once.
 */
let pending: TranslationKey | null = null

export function setInstallmentFlash(message: TranslationKey) {
  pending = message
}

/** The waiting message, taken (a second call returns null). */
export function takeInstallmentFlash(): TranslationKey | null {
  const message = pending
  pending = null
  return message
}
