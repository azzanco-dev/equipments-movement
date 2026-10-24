import type { SupabaseClient } from '@supabase/supabase-js'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import { sanitizeSearchTerm } from '@/lib/search'
import { unwrapRows } from '@/lib/supabaseResult'

/** Relational selectors show the first/best 20 matches, never more. */
export const FOREMAN_FILTER_LIMIT = 20

/** At most this many ids restored from the URL are resolved to names. */
const FOREMAN_RESOLVE_LIMIT = 100

type ForemanRow = { id: string; full_name: string | null }

/**
 * A multi-select foreman («الفورمان») filter: the supervisors of
 * `profile_names` (migration 0099: id / full_name / role only), searched by
 * name server-side 20 at a time. A failed search throws through
 * `unwrapRows`, so the control shows its load error; ids restored from the
 * URL are resolved to names in one `in` query (a failed lookup is cosmetic).
 * Shaped like `FilterBarAsyncField`; first used by «المعدات في المشاريع»
 * (2026-10-24) over the view column `entry_supervisor_id`.
 */
export function foremanFilterOptions(client: SupabaseClient) {
  const toOption = (row: ForemanRow): AsyncSearchSelectOption => ({
    value: row.id,
    label: row.full_name ?? '',
  })
  return {
    loadOptions: async (query: string) => {
      let request = client
        .from('profile_names')
        .select('id,full_name')
        .eq('role', 'supervisor')
        .order('full_name')
        .order('id')
        .limit(FOREMAN_FILTER_LIMIT)
      const term = sanitizeSearchTerm(query)
      if (term) request = request.ilike('full_name', `%${term}%`)
      return unwrapRows<ForemanRow>(await request).map(toOption)
    },
    resolveOptions: async (values: string[]) => {
      if (!values.length) return []
      const { data, error } = await client
        .from('profile_names')
        .select('id,full_name')
        .in('id', values.slice(0, FOREMAN_RESOLVE_LIMIT))
      if (error) return []
      return ((data ?? []) as ForemanRow[]).map(toOption)
    },
  }
}
