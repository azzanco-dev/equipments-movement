import { supabase } from '@/lib/supabase'
import { buildSearchFilter } from '@/lib/search'
import { unwrapRows } from '@/lib/supabaseResult'
import { supplierPoSupplierLabel } from '@/lib/purchasing'
import type { TranslationKey } from '@/i18n/translations'
import type { RoutePage } from '@/lib/navPermissions'
import {
  GLOBAL_SEARCH_GROUP_LIMIT,
  globalSearchItem,
  type GLOBAL_SEARCH_GROUPS,
  type GlobalSearchGroupId,
  type GlobalSearchItem,
} from '@/lib/globalSearch'

export type GlobalSearchGroupResult = {
  id: GlobalSearchGroupId
  label: TranslationKey
  items: GlobalSearchItem[]
  /** The read of this group failed; the others still show. */
  failed: boolean
}

type GroupDef = (typeof GLOBAL_SEARCH_GROUPS)[number]

/**
 * The header search: one bounded read per allowed group (at most five rows,
 * server-side `or` over the group's own search columns, the reader's token,
 * so RLS decides the rows), all in parallel. A failed group is marked, never
 * shown as «no results»; an aborted search throws the abort.
 */
export async function fetchGlobalSearch(
  term: string,
  groups: readonly GroupDef[],
  lang: 'ar' | 'en',
  t: (key: TranslationKey) => string,
  opens: (page: RoutePage) => boolean,
  signal: AbortSignal,
): Promise<GlobalSearchGroupResult[]> {
  const results = await Promise.all(
    groups.map(async (group): Promise<GlobalSearchGroupResult> => {
      const filter = buildSearchFilter(group.searchFields, term)
      if (!filter)
        return { id: group.id, label: group.label, items: [], failed: false }
      try {
        const rows = unwrapRows(
          await supabase
            .from(group.table)
            .select(group.select)
            .or(filter)
            .order(group.order, { ascending: true })
            .limit(GLOBAL_SEARCH_GROUP_LIMIT)
            .abortSignal(signal),
        ) as unknown as Record<string, unknown>[]
        return {
          id: group.id,
          label: group.label,
          failed: false,
          items: rows.map((row) =>
            globalSearchItem(
              group.id,
              row,
              lang,
              opens,
              group.id === 'purchaseOrders'
                ? supplierPoSupplierLabel(
                    row as Parameters<typeof supplierPoSupplierLabel>[0],
                    t,
                  )
                : undefined,
            ),
          ),
        }
      } catch (error) {
        if (signal.aborted) throw error
        return { id: group.id, label: group.label, items: [], failed: true }
      }
    }),
  )
  return results
}
