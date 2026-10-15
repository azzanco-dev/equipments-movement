// The link the «ابلاغ الفورمان» notice carries (owner request 2026-10-15): it
// opens the EXIT form with the reported unit ready, so the foreman records its
// exit from his project in one tap. Pure: the server builds the link into the
// fixed message text, the form reads it back from the URL.
//
// The link only PREFILLS the form. Selecting the unit still runs the same
// search the user would run (the site EXIT list comes from
// `search_site_exit_equipment`), and saving still goes through the API and the
// database, which decide.

/** The query parameter that carries the equipment code. */
export const EXIT_LINK_EQUIPMENT_PARAM = 'equipment'

/** Same bound as a search term (`sanitizeSearchTerm`). */
const CODE_MAX_LENGTH = 80

/** The form's path for an EXIT of `code` (the code URL-encoded). */
export function movementExitPath(code: string): string {
  return `/movements/new?type=exit&${EXIT_LINK_EQUIPMENT_PARAM}=${encodeURIComponent(code)}`
}

/**
 * The origin of `base` when a message may link to it: `https:`, or `http:` on
 * the local machine only (development). Anything else (another scheme,
 * credentials, an unparsable value) is `null`, and the message then has no link.
 */
export function linkableOrigin(base: string | null | undefined): string | null {
  if (typeof base !== 'string' || !base.trim()) return null
  let url: URL
  try {
    url = new URL(base.trim())
  } catch {
    return null
  }
  if (url.username || url.password) return null
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    return null
  return url.origin
}

/** The full EXIT link for `code` on `base`, or `null` when either is unusable. */
export function movementExitUrl(
  base: string | null | undefined,
  code: string | null | undefined,
): string | null {
  const origin = linkableOrigin(base)
  const value = equipmentCodeFromLinkParam(code)
  if (!origin || !value) return null
  return `${origin}${movementExitPath(value)}`
}

/** The code a link carries: one trimmed line, bounded; `null` when empty. */
export function equipmentCodeFromLinkParam(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null
  const code = value.replace(/\s+/g, ' ').trim().slice(0, CODE_MAX_LENGTH)
  return code || null
}

/** Compared like the database duplicate checks: upper(btrim(code)). */
function sameCode(a: string | null | undefined, b: string): boolean {
  return (a ?? '').trim().toUpperCase() === b.trim().toUpperCase()
}

/**
 * The unit to select automatically for a linked EXIT: the ONE search result
 * whose CURRENT code equals the linked code. A result found through a previous
 * code (`matched_previous_code`) never counts, and two or more matches select
 * nothing, so the user picks from the list as usual.
 */
export function pickLinkedExitEquipment<
  T extends { code?: string | null; matched_previous_code?: boolean | null },
>(
  rows: readonly T[] | null | undefined,
  code: string | null | undefined,
): T | null {
  const wanted = equipmentCodeFromLinkParam(code)
  if (!wanted || !Array.isArray(rows)) return null
  const matches = rows.filter(
    (row) =>
      row !== null &&
      typeof row === 'object' &&
      row.matched_previous_code !== true &&
      sameCode(row.code, wanted),
  )
  return matches.length === 1 ? matches[0] : null
}
