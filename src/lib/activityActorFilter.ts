import type { SupabaseClient } from '@supabase/supabase-js'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import { ACTIVITY_SYSTEM_ACTOR } from '@/lib/activityLog'
import { sanitizeSearchTerm } from '@/lib/search'
import { unwrapRows } from '@/lib/supabaseResult'

/** Relational selectors show the first/best 20 matches, never more. */
const ACTOR_FILTER_LIMIT = 20
/** At most this many ids restored from the URL are resolved to names. */
const ACTOR_RESOLVE_LIMIT = 100

type ActorRow = { id: string; full_name: string | null }

/**
 * The «المستخدم» filter of the activity page: every user of `profile_names`
 * (any role — a unit or a movement may have been changed by anyone), searched
 * by name server-side 20 at a time, plus «النظام» (`systemLabel`) for the rows
 * written without a signed-in user (a migration, a service-role path): it is
 * the shared empty-value option, which `applyListFilters` turns into
 * `actor_id IS NULL`. Shaped like `FilterBarAsyncField`; a failed search
 * throws through `unwrapRows` so the control shows its load error.
 */
export function activityActorFilterOptions(
  client: SupabaseClient,
  systemLabel: string,
) {
  const system: AsyncSearchSelectOption = {
    value: ACTIVITY_SYSTEM_ACTOR,
    label: systemLabel,
  }
  const toOption = (row: ActorRow): AsyncSearchSelectOption => ({
    value: row.id,
    label: row.full_name ?? '',
  })
  return {
    loadOptions: async (query: string) => {
      const term = sanitizeSearchTerm(query)
      let request = client
        .from('profile_names')
        .select('id,full_name')
        .order('full_name')
        .order('id')
        .limit(ACTOR_FILTER_LIMIT)
      if (term) request = request.ilike('full_name', `%${term}%`)
      const users = unwrapRows<ActorRow>(await request).map(toOption)
      // «النظام» first on an empty search, or when its label matches.
      const showSystem = !term || systemLabel.includes(term)
      return showSystem ? [system, ...users] : users
    },
    resolveOptions: async (values: string[]) => {
      const ids = values.filter((value) => value !== ACTIVITY_SYSTEM_ACTOR)
      const resolved: AsyncSearchSelectOption[] = values.includes(
        ACTIVITY_SYSTEM_ACTOR,
      )
        ? [system]
        : []
      if (!ids.length) return resolved
      const { data, error } = await client
        .from('profile_names')
        .select('id,full_name')
        .in('id', ids.slice(0, ACTOR_RESOLVE_LIMIT))
      if (error) return resolved
      return [...resolved, ...((data ?? []) as ActorRow[]).map(toOption)]
    },
  }
}
