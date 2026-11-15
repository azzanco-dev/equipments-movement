import { supabase } from '@/lib/supabase'
import type { PostgresLikeError } from '@/lib/formValidation'
import {
  buildPastVisitPayload,
  parsePastVisitResult,
  type PastVisitValues,
} from '@/lib/pastVisit'

/**
 * `add_past_site_visit` (migration 0197): the whole past project visit — its
 * entry and its exit — in ONE database call. The screen never inserts into
 * `entry_exit_logs` itself.
 */
export async function addPastSiteVisit(
  values: PastVisitValues,
): Promise<
  | { data: { entryId: string; exitId: string }; error: null }
  | { data: null; error: PostgresLikeError }
> {
  const { data, error } = await supabase.rpc(
    'add_past_site_visit',
    buildPastVisitPayload(values),
  )
  if (error)
    return {
      data: null,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      },
    }
  const ids = parsePastVisitResult(data)
  if (!ids)
    return { data: null, error: { message: 'unexpected_result' } }
  return { data: ids, error: null }
}
