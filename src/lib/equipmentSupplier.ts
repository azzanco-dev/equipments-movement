import type { SupabaseClient } from '@supabase/supabase-js'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import type { FilterField } from '@/components/data-list/types'
import { buildSearchFilter, NAME_SEARCH_FIELDS } from '@/lib/search'
import { unwrapRows } from '@/lib/supabaseResult'

/**
 * The equipment supplier in the admin log (owner request 2026-10-15,
 * migration 0132): the «المورد» filter and the supplier line under the
 * equipment. Both views expose `equipment_lessor_id` (filtered on) and
 * `equipment_lessor_name` (displayed).
 */

/** The owner «مالك اخر», the only owner whose supplier the log shows. */
export const SUPPLIER_OWNER = 'external_supplier'

/** The view column the supplier filter applies to (migration 0132). */
export const SUPPLIER_FILTER_KEY = 'equipment_lessor_id'

/**
 * The «المورد» filter of both admin log views (`logsListConfig`,
 * `adminVisitsListConfig`): a multi-select (`in`) of supplier ids, searched
 * server-side through the screen's `asyncFields` (`lessorFilterOptions`).
 * It is offered only while the owner filter selects «مالك اخر», and dropped
 * when the owner filter stops selecting it (`visibleWhen`).
 */
export const SUPPLIER_FILTER_FIELD: FilterField = {
  key: SUPPLIER_FILTER_KEY,
  label: 'supplierFilter',
  type: 'select',
  operators: ['in'],
  options: [],
  multiple: true,
  visibleWhen: {
    field: 'equipment_ownership_status',
    includes: SUPPLIER_OWNER,
  },
}

/**
 * The supplier name shown as a small second line under the equipment code in
 * the log and visits tables: only for an equipment owned by «مالك اخر» that
 * has a supplier, else `null` (no line, no new column).
 */
export function equipmentSupplierLine(row: {
  equipment_ownership_status?: string | null
  equipment_lessor_name?: string | null
}): string | null {
  if (row.equipment_ownership_status !== SUPPLIER_OWNER) return null
  const name = row.equipment_lessor_name?.trim()
  return name ? name : null
}

/** Relational selectors show the first/best 20 matches, never more. */
export const LESSOR_FILTER_LIMIT = 20

/** At most this many ids restored from the URL are resolved to names. */
const LESSOR_RESOLVE_LIMIT = 100

type LessorRow = { id: string; name: string | null }

/**
 * The supplier («المورد») filter of the admin log, a multi-select over
 * `lessors` (owner request 2026-10-15). Search runs in PostgreSQL over the
 * normalized name (`name_search`, migration 0116, through the shared
 * sanitizing builder), returns at most 20 rows and selects only `id,name`.
 * A failed search throws through `unwrapRows`, so the control shows its load
 * error instead of "no results"; the raw PostgREST message never reaches the
 * user. Ids restored from the URL are resolved to names in one `in` query
 * (a failed lookup is cosmetic: the filter itself still applies).
 *
 * Shaped like `FilterBarAsyncField`; the screen passes it in `asyncFields`
 * under the view column `equipment_lessor_id` (migration 0132).
 */
export function lessorFilterOptions(client: SupabaseClient) {
  const toOption = (row: LessorRow): AsyncSearchSelectOption => ({
    value: row.id,
    label: row.name ?? '',
  })
  return {
    loadOptions: async (query: string) => {
      let request = client
        .from('lessors')
        .select('id,name')
        .order('name')
        .order('id')
        .limit(LESSOR_FILTER_LIMIT)
      const searchFilter = buildSearchFilter(NAME_SEARCH_FIELDS, query)
      if (searchFilter) request = request.or(searchFilter)
      return unwrapRows<LessorRow>(await request).map(toOption)
    },
    resolveOptions: async (values: string[]) => {
      if (!values.length) return []
      const { data, error } = await client
        .from('lessors')
        .select('id,name')
        .in('id', values.slice(0, LESSOR_RESOLVE_LIMIT))
      if (error) return []
      return ((data ?? []) as LessorRow[]).map(toOption)
    },
  }
}
