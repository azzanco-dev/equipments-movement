import type { TranslationKey } from '@/i18n/translations'

/**
 * The sections of the sidebar (owner 2026-11-23, model 1 approved in Figma
 * «اعتمد»: «الرئيسية», «البيانات» — «المعدات في البيانات» —, «المالية»,
 * «الادارة»). Display only: which items a user sees, and the landing page,
 * still come from `NAV_ENTRIES` in its own order.
 */
export type NavGroupKey = 'home' | 'data' | 'finance' | 'admin'

export interface NavGroup {
  key: NavGroupKey
  labelKey: TranslationKey
  /** The top-level nav keys of the section, in the order they show. */
  items: readonly string[]
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { key: 'home', labelKey: 'navGroupHome', items: ['dashboard', 'logs', 'inquiry'] },
  {
    key: 'data',
    labelKey: 'navGroupData',
    items: ['equipment', 'projects', 'companies', 'lessors', 'drivers'],
  },
  {
    key: 'finance',
    labelKey: 'navGroupFinance',
    items: ['purchasing', 'sales', 'installments'],
  },
  {
    key: 'admin',
    labelKey: 'navGroupAdmin',
    items: ['users', 'settings', 'activity', 'movement-import'],
  },
]

/**
 * The visible items in their sections: a section without a visible item is
 * left out, and an item no section names joins the last one, so nothing the
 * permissions show is ever dropped.
 */
export function groupNavItems<T extends { key: string }>(
  items: readonly T[],
): { key: NavGroupKey; labelKey: TranslationKey; items: T[] }[] {
  const byKey = new Map(items.map((item) => [item.key, item]))
  const named = new Set(NAV_GROUPS.flatMap((group) => group.items))
  const groups = NAV_GROUPS.map((group) => ({
    key: group.key,
    labelKey: group.labelKey,
    items: group.items.flatMap((key) => {
      const item = byKey.get(key)
      return item ? [item] : []
    }),
  }))
  const rest = items.filter((item) => !named.has(item.key))
  groups[groups.length - 1].items.push(...rest)
  return groups.filter((group) => group.items.length > 0)
}
