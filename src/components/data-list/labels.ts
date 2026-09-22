import { useCallback } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { translations, type Language } from '@/i18n/translations'
import type { FilterOption, ListLabel } from './types'

/**
 * Resolves a config label for one language. A `TranslationKey` goes through
 * the shared dictionary (falling back to Arabic, like `useI18n().t`); an
 * inline `{ ar, en }` pair is used as written.
 */
export function resolveListLabel(label: ListLabel, lang: Language): string {
  if (typeof label === 'string') {
    const dictionary: Record<string, string | undefined> = translations[lang]
    const fallback: Record<string, string | undefined> = translations.ar
    return dictionary[label] ?? fallback[label] ?? label
  }
  return label[lang] ?? label.ar
}

/**
 * Option text for a filter value. Static options carry `labelI18n` and follow
 * the interface language; runtime options (a foreman name, for example) keep
 * their own text.
 */
export function resolveOptionLabel(
  option: FilterOption,
  lang: Language,
): string {
  if (!option.labelI18n) return option.label
  return resolveListLabel(option.labelI18n, lang)
}

/** `resolveListLabel` bound to the current interface language. */
export function useListLabel() {
  const { lang } = useI18n()
  return useCallback(
    (label: ListLabel) => resolveListLabel(label, lang),
    [lang],
  )
}

/** `resolveOptionLabel` bound to the current interface language. */
export function useOptionLabel() {
  const { lang } = useI18n()
  return useCallback(
    (option: FilterOption) => resolveOptionLabel(option, lang),
    [lang],
  )
}
