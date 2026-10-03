/**
 * Thrown by `unwrapRows` when a Supabase query fails. The message is a fixed,
 * safe string: the raw PostgREST/PostgreSQL error is never copied into it, so
 * a caller that shows `error.message` cannot leak database details. Callers
 * are expected to map this to a translated UI message (for example the
 * `optionsLoadError` state of `AsyncSearchSelect`).
 */
export class SupabaseLoadError extends Error {
  constructor() {
    super('load_failed')
    this.name = 'SupabaseLoadError'
  }
}

/**
 * Returns the rows of a Supabase query result, or throws `SupabaseLoadError`
 * when the query failed. Use it in loaders so a network/RLS failure surfaces
 * as an error state instead of an empty "no results" list.
 */
export function unwrapRows<T>(result: {
  data: T[] | null
  error: unknown
}): T[] {
  if (result.error) throw new SupabaseLoadError()
  return result.data ?? []
}
