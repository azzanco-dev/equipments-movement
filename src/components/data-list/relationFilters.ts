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
 * Narrows the options to the ones a foreman has actually used: only companies
 * / projects that appear on a movement this user recorded.
 */
export interface RelationFilterScope {
  supervisorId?: string
}

/** The `entry_exit_logs` foreign key column that points at each master table. */
const MOVEMENT_FK: Record<NamedRelationTable, 'company_id' | 'project_id'> = {
  companies: 'company_id',
  projects: 'project_id',
}

/**
 * A multi-select relational filter over a bilingual master table.
 *
 * Search runs in PostgreSQL (`name_ar` / `name_en`, sanitized term), returns
 * at most 20 rows and selects only `id,name_ar,name_en`. Ids restored from
 * the URL are resolved to names in one `in` query. Errors are rethrown so the
 * control shows its own safe load-error state; the raw PostgREST message never
 * reaches the user.
 *
 * With `scope.supervisorId` (the foreman home) the options are limited to the
 * rows referenced by that user's own movements, still in one bounded request:
 * a PostgREST inner embed of `entry_exit_logs` through its `company_id` /
 * `project_id` foreign key (migration 0010; named explicitly so a second
 * relationship could never make the embed ambiguous), filtered to
 * `supervisor_id` and capped at one embedded row per option, because only its
 * existence matters. RLS on `entry_exit_logs` stays authoritative; the
 * explicit predicate mirrors the list the filter belongs to.
 */
export function namedRelationFilter(
  table: NamedRelationTable,
  lang: Language,
  scope: RelationFilterScope = {},
): FilterBarAsyncField {
  const toOption = (row: NamedRow): AsyncSearchSelectOption => ({
    value: row.id,
    label: localizedName(lang, row.name_ar, row.name_en),
  })
  const nameColumn = lang === 'ar' ? 'name_ar' : 'name_en'
  const { supervisorId } = scope
  const source = () =>
    supervisorId
      ? supabase
          .from(table)
          .select(
            `id,name_ar,name_en,entry_exit_logs!${MOVEMENT_FK[table]}!inner(id)`,
          )
          .eq('entry_exit_logs.supervisor_id', supervisorId)
          .limit(1, { foreignTable: 'entry_exit_logs' })
      : supabase.from(table).select('id,name_ar,name_en')
  return {
    loadOptions: async (query) => {
      let request = source()
        .order(nameColumn)
        .order('id')
        .limit(RELATION_FILTER_LIMIT)
      const term = sanitizeSearchTerm(query)
      if (term)
        request = request.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data, error } = await request
      if (error) throw error
      // `toOption` reads only the three name fields, which drops the embed.
      return ((data ?? []) as NamedRow[]).map(toOption)
    },
    resolveOptions: async (values) => {
      if (!values.length) return []
      const { data, error } = await source().in('id', values.slice(0, 100))
      if (error) return []
      return ((data ?? []) as NamedRow[]).map(toOption)
    },
  }
}

/**
 * Company and project multi-select filters for a list backed by
 * `company_id` / `project_id` columns (the `/logs` views and the foreman
 * home). Memoized per language and scope, so a screen can pass them in
 * `asyncFields` without the controls reloading on every render:
 *
 *   const relations = useCompanyProjectFilters()
 *   const asyncFields = useMemo(
 *     () => ({ supervisor_id: foremanFilter, ...relations }),
 *     [relations],
 *   )
 *
 * Admin and monitor call it without a scope and search every company and
 * project; the foreman home passes `{ supervisorId }` and gets only the ones
 * on that foreman's own movements.
 */
export function useCompanyProjectFilters(
  scope: RelationFilterScope = {},
): Record<'company_id' | 'project_id', FilterBarAsyncField> {
  const { lang } = useI18n()
  const { supervisorId } = scope
  return useMemo(
    () => ({
      company_id: namedRelationFilter('companies', lang, { supervisorId }),
      project_id: namedRelationFilter('projects', lang, { supervisorId }),
    }),
    [lang, supervisorId],
  )
}
