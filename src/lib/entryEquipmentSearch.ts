import type { Language, TranslationKey } from '@/i18n/translations'
import { plateDigitsSearchTerm } from '@/lib/plate'
import { localizedName } from '@/lib/localizedName'
import { saudiDateKey } from '@/lib/saudiTime'

// Arguments for `search_entry_equipment`, the database function that lists the
// equipment offered for a site ENTRY together with where each piece currently
// is. Equipment inside a site stays listed on purpose: hiding it made foremen
// quick-create duplicates (owner decision 2026-09-19).
export interface EntryEquipmentArgs {
  p_search: string | null
  p_ownership_status: string | null
  p_plate_digits: string | null
}

// `term` is already sanitized and converted to Latin digits by the caller, the
// same way the EXIT equipment query prepares it. The plate probe stays a
// separate argument so the search term itself is never split into plate parts.
export function entryEquipmentArgs(
  term: string,
  ownershipStatus: string,
): EntryEquipmentArgs {
  const trimmed = term.trim()
  return {
    p_search: trimmed || null,
    p_ownership_status: ownershipStatus || null,
    p_plate_digits: trimmed ? plateDigitsSearchTerm(trimmed) : null,
  }
}

export type EntryEquipmentState =
  'inside_site' | 'inside_workshop' | 'outside' | 'none'

/**
 * The state columns `search_entry_equipment` adds to an equipment row. All
 * optional, so a row coming from any other equipment query still type-checks.
 */
export interface EntryEquipmentStateFields {
  state?: EntryEquipmentState | null
  state_since?: string | null
  state_company_name_ar?: string | null
  state_company_name_en?: string | null
  state_project_name_ar?: string | null
  state_project_name_en?: string | null
  state_workshop_purpose?: 'maintenance' | 'parking' | null
}

export interface EntryEquipmentRow extends EntryEquipmentStateFields {
  id: string
  code: string
}

/**
 * Tones the option badge may use. A subset of the shared `BadgeTone`, declared
 * here so this module stays free of component imports.
 */
export type EntryEquipmentBadgeTone = 'entry' | 'info' | 'warning' | 'neutral'

export interface EntryEquipmentBadge {
  label: string
  tone: EntryEquipmentBadgeTone
}

export interface EntryEquipmentOption {
  value: string
  label: string
  /** ONE secondary line, muted, under the label. */
  description?: string
  badge?: EntryEquipmentBadge
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whole days between two instants counted by Saudi calendar day, so a visit
 * opened yesterday evening reads as 1 day and not as 0. Never negative.
 */
export function saudiDaysSince(
  since: string,
  now: Date | string = new Date(),
): number {
  // `saudiDateKey` throws on an unreadable value, and a bad timestamp must
  // never take the equipment list down with it.
  const sinceTime = new Date(since).getTime()
  const nowTime = new Date(now).getTime()
  if (Number.isNaN(sinceTime) || Number.isNaN(nowTime)) return 0
  const from = Date.parse(`${saudiDateKey(new Date(sinceTime))}T00:00:00Z`)
  const to = Date.parse(`${saudiDateKey(new Date(nowTime))}T00:00:00Z`)
  return Math.max(0, Math.round((to - from) / DAY_MS))
}

/**
 * Maps one `search_entry_equipment` row to the option the ENTRY equipment list
 * renders: the equipment code, a state badge and at most one secondary line.
 *
 *   inside a site     badge "داخل موقع"  + "company - project · منذ N يوم"
 *   inside the workshop badge "في الورشة" + the purpose (صيانة / وقوف)
 *   available         nothing extra
 *
 * Pure: the caller passes `now` in tests, and the day count uses Saudi day
 * keys so it matches the reports.
 */
export function equipmentStateOption(
  row: EntryEquipmentRow,
  lang: Language,
  t: (key: TranslationKey) => string,
  now: Date | string = new Date(),
): EntryEquipmentOption {
  const option: EntryEquipmentOption = { value: row.id, label: row.code }

  if (row.state === 'inside_site') {
    option.badge = { label: t('insideSiteBadge'), tone: 'entry' }
    const company = localizedName(
      lang,
      row.state_company_name_ar,
      row.state_company_name_en,
    )
    const project = localizedName(
      lang,
      row.state_project_name_ar,
      row.state_project_name_en,
    )
    // A same-day visit would read "منذ 0 يوم", so the day count is dropped
    // until the visit is at least one Saudi day old.
    const days = row.state_since ? saudiDaysSince(row.state_since, now) : 0
    const place = `${company} - ${project}`
    option.description = days
      ? `${place} · ${t('sinceDays').replace('{count}', String(days))}`
      : place
    return option
  }

  if (row.state === 'inside_workshop') {
    option.badge = { label: t('insideWorkshopBadge'), tone: 'info' }
    option.description =
      row.state_workshop_purpose === 'maintenance'
        ? t('maintenancePurpose')
        : row.state_workshop_purpose === 'parking'
          ? t('parkingPurpose')
          : t('pendingClassification')
    return option
  }

  return option
}
