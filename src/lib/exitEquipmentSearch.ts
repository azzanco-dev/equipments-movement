import { plateDigitsSearchTerm } from '@/lib/plate'

// Arguments for `search_site_exit_equipment`, the database function that lists
// the equipment a caller may actually register a site EXIT for (its own open
// visits, or every open visit for an admin).
export interface SiteExitEquipmentArgs {
  p_search: string | null
  p_ownership_status: string | null
  p_plate_digits: string | null
}

// `term` is already sanitized and converted to Latin digits by the caller, the
// same way the ENTRY equipment query prepares it. The plate probe stays a
// separate argument so the search term itself is never split into plate parts.
export function siteExitEquipmentArgs(
  term: string,
  ownershipStatus: string,
): SiteExitEquipmentArgs {
  const trimmed = term.trim()
  return {
    p_search: trimmed || null,
    p_ownership_status: ownershipStatus || null,
    p_plate_digits: trimmed ? plateDigitsSearchTerm(trimmed) : null,
  }
}
