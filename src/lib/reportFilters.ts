/**
 * The owner + context filter shared by the four report screens
 * (`/reports/entries`, `/reports/entries/all`, `/reports/equipment`,
 * `/reports/workshop`).
 *
 * Everything here is pure: the screens read the two values out of the URL, send
 * them to the database (`p_owners` / `p_context`, or a PostgREST `.in(...)`),
 * and write them back with `router.replace`, so Back restores the same report.
 *
 * Two invariants this module exists to keep in one place:
 *
 *  * An empty owner selection means "every owner", never "no owners" — the
 *    same meaning `OwnerFilter` and migration 0095's `admin_home_owner_filter`
 *    already give it, which is why the argument sent to the database is `null`
 *    rather than `[]`.
 *  * `site` is the default context, which is exactly what the reports did
 *    before this filter existed, so a URL without the parameter produces the
 *    previous report unchanged. The parameter is therefore only written when it
 *    differs from that default, and an unknown value degrades to it instead of
 *    reaching the database.
 */
import {
  normalizeOwnerFilters,
  ownerFilterArgument,
  type AdminHomeOwner,
} from '@/lib/adminHomeStats'

/** The `p_context` values migration 0102 accepts. */
export const REPORT_CONTEXTS = ['site', 'workshop', 'all'] as const

export type ReportContext = (typeof REPORT_CONTEXTS)[number]

/** What the reports filtered on before the context tabs existed. */
export const DEFAULT_REPORT_CONTEXT: ReportContext = 'site'

/** The URL parameter names, so no screen spells them itself. */
export const REPORT_OWNERS_PARAM = 'owners'
export const REPORT_CONTEXT_PARAM = 'context'

/** The one selection the «العزاني فقط» shortcut stands for. */
export const ALAZANI_ONLY: AdminHomeOwner[] = ['alazani']

/**
 * Reads the owner selection out of a `?owners=a,b` parameter.
 *
 * Unknown, duplicated and empty entries are dropped and the rest is put back
 * into the canonical owner order, so a hand-edited link can never widen the
 * query or change the request signature.
 */
export function parseReportOwners(
  raw: string | string[] | null | undefined,
): AdminHomeOwner[] {
  return normalizeOwnerFilters(raw)
}

/** The parameter value for a selection; an empty string means "every owner". */
export function serializeReportOwners(
  owners: AdminHomeOwner[] | string[] | null | undefined,
): string {
  return parseReportOwners(owners as string[]).join(',')
}

/**
 * The `p_owners` argument: `null` for "every owner", never an empty array, so
 * the URL and the database agree on what "nothing selected" means.
 */
export function reportOwnersArgument(
  owners: AdminHomeOwner[] | string[] | null | undefined,
): AdminHomeOwner[] | null {
  return ownerFilterArgument(owners)
}

export function isReportContext(value: unknown): value is ReportContext {
  return (REPORT_CONTEXTS as readonly unknown[]).includes(value)
}

/** Reads `?context=`; anything unknown falls back to the previous behaviour. */
export function parseReportContext(
  raw: string | null | undefined,
  fallback: ReportContext = DEFAULT_REPORT_CONTEXT,
): ReportContext {
  const value = (raw ?? '').trim()
  return isReportContext(value) ? value : fallback
}

/** True when the selection is exactly the «العزاني فقط» shortcut. */
export function isAlazaniOnly(
  owners: AdminHomeOwner[] | string[] | null | undefined,
): boolean {
  const normalized = parseReportOwners(owners as string[])
  return normalized.length === 1 && normalized[0] === 'alazani'
}

/** Pressing the shortcut again clears it back to "every owner". */
export function toggleAlazaniOnly(
  owners: AdminHomeOwner[] | string[] | null | undefined,
): AdminHomeOwner[] {
  return isAlazaniOnly(owners) ? [] : [...ALAZANI_ONLY]
}

/**
 * Writes both values into a `URLSearchParams` the screen is about to push.
 *
 * A default value is removed rather than written, so the filtered links stay
 * short and an untouched report keeps exactly the URL it had before.
 */
export function applyReportFilterParams(
  params: URLSearchParams,
  owners: AdminHomeOwner[] | string[] | null | undefined,
  context?: ReportContext | null,
): URLSearchParams {
  const value = serializeReportOwners(owners as string[])
  if (value) params.set(REPORT_OWNERS_PARAM, value)
  else params.delete(REPORT_OWNERS_PARAM)

  if (context && context !== DEFAULT_REPORT_CONTEXT)
    params.set(REPORT_CONTEXT_PARAM, context)
  else params.delete(REPORT_CONTEXT_PARAM)

  return params
}
