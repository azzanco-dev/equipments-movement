import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Recorder ("supervisor") display names for movement rows.
 *
 * `public.profiles` is hidden from other users by `select_profiles` (0076),
 * so an embed such as `supervisor:profiles(*)` returns NULL names for every
 * role that cannot read the recorder's own row. Migration 0099 added
 * `public.profile_names (id, full_name, role)`: a reviewed, name-only view
 * that every authenticated user may read.
 *
 * The migrations never declare `entry_exit_logs.supervisor_id -> profiles`
 * (0001 references `auth.users`), so PostgREST has no foreign key it could
 * use to embed the view reliably. The names are therefore read with a second,
 * small query keyed by the distinct recorder ids of the rows on screen.
 *
 * This file has no runtime imports so the node tests can load it directly.
 */

export const PROFILE_NAMES_VIEW = 'profile_names'
/** Never widen this list: the view is a name lookup, nothing more. */
export const PROFILE_NAMES_SELECT = 'id,full_name'

export interface ProfileName {
  id: string
  full_name: string
}

export interface ProfileNamesResult {
  names: Map<string, string>
  /** `true` when the lookup itself failed, so a caller can show an error
   *  instead of silently rendering every recorder as "—". */
  failed: boolean
}

/** Distinct, non-empty ids in first-seen order. */
export function uniqueProfileIds(
  ids: ReadonlyArray<string | null | undefined>,
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

/** `id -> full_name` for the rows the view returned. */
export function toProfileNameMap(
  rows: ReadonlyArray<Partial<ProfileName> | null> | null | undefined,
): Map<string, string> {
  const names = new Map<string, string>()
  for (const row of rows ?? []) {
    if (row?.id && row.full_name) names.set(row.id, row.full_name)
  }
  return names
}

/**
 * Attaches `supervisor: { id, full_name }` to each row, the same shape the
 * former `supervisor:profiles(id,full_name)` embed produced, so consumers
 * that read `row.supervisor?.full_name` keep working unchanged.
 */
export function withSupervisorNames<T extends { supervisor_id: string | null }>(
  rows: ReadonlyArray<T>,
  names: Map<string, string>,
): Array<T & { supervisor: ProfileName | null }> {
  return rows.map((row) => {
    const fullName = row.supervisor_id ? names.get(row.supervisor_id) : null
    return {
      ...row,
      supervisor:
        row.supervisor_id && fullName
          ? { id: row.supervisor_id, full_name: fullName }
          : null,
    }
  })
}

/** Reads the display names of `ids` from `profile_names`. No ids, no request. */
export async function fetchProfileNames(
  client: SupabaseClient,
  ids: ReadonlyArray<string | null | undefined>,
  signal?: AbortSignal,
): Promise<ProfileNamesResult> {
  const unique = uniqueProfileIds(ids)
  if (unique.length === 0) return { names: new Map(), failed: false }
  let query = client
    .from(PROFILE_NAMES_VIEW)
    .select(PROFILE_NAMES_SELECT)
    .in('id', unique)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) return { names: new Map(), failed: true }
  return {
    names: toProfileNameMap(data as ReadonlyArray<Partial<ProfileName>> | null),
    failed: false,
  }
}
