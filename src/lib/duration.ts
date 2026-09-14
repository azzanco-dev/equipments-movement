import type { TranslationKey } from '@/i18n/translations'
import type { Language } from '@/i18n/translations'

type Translate = (key: TranslationKey) => string

function inflectArabic(
  count: number,
  forms: readonly [string, string, string, string],
) {
  if (count === 1) return forms[0]
  if (count === 2) return forms[1]
  if (count >= 3 && count <= 10) return forms[2]
  return forms[3]
}

function durationUnit(
  count: number,
  unit: 'year' | 'month',
  lang: Language,
): string {
  if (lang === 'en') return `${count} ${unit}${count === 1 ? '' : 's'}`
  const forms =
    unit === 'year'
      ? (['سنة', 'سنتان', 'سنوات', 'سنة'] as const)
      : (['شهر', 'شهران', 'اشهر', 'شهرا'] as const)
  const word = inflectArabic(count, forms)
  return count <= 2 ? word : `${count} ${word}`
}

export function formatElapsedDuration(
  ms: number,
  t: Translate,
  lang: Language,
): string {
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
      ? `${durationUnit(months, 'month', lang)} ${days} ${t('days')}`
      : durationUnit(months, 'month', lang)
  }

  const years = Math.floor(totalDays / 365)
  const months = Math.floor((totalDays % 365) / 30)
  return months
    ? `${durationUnit(years, 'year', lang)} ${durationUnit(months, 'month', lang)}`
    : durationUnit(years, 'year', lang)
}
