import type { TranslationKey } from '@/i18n/translations'

type Translate = (key: TranslationKey) => string

export function formatElapsedDuration(ms: number, t: Translate): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000))
  const totalHours = Math.floor(totalMinutes / 60)
  const totalDays = Math.floor(totalHours / 24)

  if (totalMinutes < 60) return `${totalMinutes} ${t('minutes')}`

  if (totalHours < 24) return `${totalHours} ${t('hours')}`

  if (totalDays < 30) return `${totalDays} ${t('days')}`

  if (totalDays < 365) {
    const months = Math.floor(totalDays / 30)
    const days = totalDays % 30
    return days
      ? `${months} ${t('months')} ${days} ${t('days')}`
      : `${months} ${t('months')}`
  }

  const years = Math.floor(totalDays / 365)
  const months = Math.floor((totalDays % 365) / 30)
  return months
    ? `${years} ${t('years')} ${months} ${t('months')}`
    : `${years} ${t('years')}`
}
