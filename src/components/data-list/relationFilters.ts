import { useMemo } from 'react'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import { useI18n } from '@/i18n/I18nContext'
import type { Language } from '@/i18n/translations'
import { localizedName } from '@/lib/localizedName'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import type { FilterBarAsyncField } from './FilterBar'

/** Relational selectors show the first/best 20 matches, never more. */
export const RELATION_FILTER_LIMIT = 20

/** Master tables with the bilingual `name_ar` / `name_en` pair. */
export type NamedRelationTable = 'companies' | 'projects'

type NamedRow = { id: string; name_ar: string | null; name_en: string | null }

/**
 * A multi-select relational filter over a bilingual master table.
 *
 * Search runs in PostgreSQL (`name_ar` / `name_en`, sanitized term), returns
 * at most 20 rows and selects only `id,name_ar,name_en`. Ids restored from
 * the URL are resolved to names in one `in` query. Errors are rethrown so the
 * control shows its own safe load-error state; the raw PostgREST message never
 * reaches the user.
 */
export function namedRelationFilter(
  table: NamedRelationTable,
  lang: Language,
): FilterBarAsyncField {
  const toOption = (row: NamedRow): AsyncSearchSelectOption => ({
    value: row.id,
    label: localizedName(lang, row.name_ar, row.name_en),
  })
  const nameColumn = lang === 'ar' ? 'name_ar' : 'name_en'
  return {
    loadOptions: async (query) => {
      let request = supabase
        .from(table)
        .select('id,name_ar,name_en')
        .order(nameColumn)
        .order('id')
        .limit(RELATION_FILTER_LIMIT)
      const term = sanitizeSearchTerm(query)
      if (term)
        request = request.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data, error } = await request
      if (error) throw error
      return ((data ?? []) as NamedRow[]).map(toOption)
    },
    resolveOptions: async (values) => {
      if (!values.length) return []
      const { data, error } = await supabase
        .from(table)
        .select('id,name_ar,name_en')
        .in('id', values.slice(0, 100))
      if (error) return []
      return ((data ?? []) as NamedRow[]).map(toOption)
    },
  }
}

/**
 * Company and project multi-select filters for a list backed by
 * `company_id` / `project_id` columns (the `/logs` view). Memoized per
 * language, so a screen can pass them in `asyncFields` without the controls
 * reloading on every render:
 *
 *   const relations = useCompanyProjectFilters()
 *   const asyncFields = useMemo(
 *     () => ({ supervisor_id: foremanFilter, ...relations }),
 *     [relations],
 *   )
 */
export function useCompanyProjectFilters(): Record<
  'company_id' | 'project_id',
  FilterBarAsyncField
> {
  const { lang } = useI18n()
  return useMemo(
    () => ({
      company_id: namedRelationFilter('companies', lang),
      project_id: namedRelationFilter('projects', lang),
    }),
    [lang],
  )
}
