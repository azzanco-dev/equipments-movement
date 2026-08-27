import type { Language } from '@/i18n/translations'

export function localizedName(
  lang: Language,
  nameAr?: string | null,
  nameEn?: string | null,
): string {
  const preferred = lang === 'ar' ? nameAr : nameEn
  const fallback = lang === 'ar' ? nameEn : nameAr
  return preferred?.trim() || fallback?.trim() || '—'
}
