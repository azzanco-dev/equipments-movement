import { saudiDateKey } from '@/lib/saudiTime'
import { buildSearchFilter } from '@/lib/search'
import type { Language, TranslationKey } from '@/i18n/translations'
import type {
  DataListConfig,
  FilterField,
  FilterOperator,
} from '@/components/data-list/types'
import type { ExcelColumn } from '@/lib/excel'
import {
  EXIT_PURPOSE_FILTER_FIELD,
  exitPurposeExportLabel,
  exitPurposeOrNull,
  type ExitPurpose,
} from '@/lib/exitPurpose'
import {
  DRIVER_CHANGES_SELECT,
  EXPORT_LOOKUP_CHUNK_SIZE,
  chunkItems,
  distinctIds,
  driverMobilesById,
  exportOwnerLabel,
  exportText,
  latestDriverChanges,
  lookupValue,
  supplierNamesByEquipment,
  type DriverChangeRow,
  type DriverMobileRow,
  type EquipmentExportRow,
  type ExportLookups,
} from '@/lib/exportFields'

/**
 * `movement_visits` (migration 0096) is a `security_invoker` view with one
 * row per visit: each ENTRY paired with the EXIT that follows it in the same
 * (equipment, movement_context) sequence, ordered by `(recorded_at, id)`.
 * Searching, counting, sorting and pagination therefore all run in PostgreSQL,
 * exactly like the movement log does through `movement_log_search`.
 *
 * Everything in this file is pure so `tests/visits-list.test.cjs` can exercise
 * it without React or a bundler; the only imports are other pure helpers and
 * types (erased at compile time).
 */
export const EQUIPMENT_VISITS_VIEW = 'movement_visits'

/**
 * Only the columns the visits tables render, search or export.
 *
 * `contractor_equipment_code` was appended to the view by migration 0106, so
 * that migration must be applied before this select is shipped. The same
 * holds for `exit_purpose`, appended by migration 0118.
 */
export const EQUIPMENT_VISITS_SELECT =
  'entry_id,exit_id,equipment_id,equipment_code,equipment_type,equipment_plate_number,movement_context,workshop_purpose,company_id,company_name_ar,company_name_en,project_id,project_name_ar,project_name_en,entry_supervisor_id,entry_supervisor_name,exit_supervisor_id,driver_id,driver_name,entry_at,exit_at,is_open,duration_minutes,contractor_equipment_code,equipment_ownership_status,exit_purpose'

export interface EquipmentVisitRow {
  entry_id: string
  exit_id: string | null
  equipment_id: string
  equipment_code: string | null
  equipment_type: string | null
  equipment_plate_number?: string | null
  movement_context: 'site' | 'workshop'
  workshop_purpose: 'maintenance' | 'parking' | null
  company_id: string | null
  company_name_ar: string | null
  company_name_en: string | null
  project_id: string | null
  project_name_ar: string | null
  project_name_en: string | null
  entry_supervisor_id: string | null
  entry_supervisor_name: string | null
  exit_supervisor_id: string | null
  driver_id: string | null
  driver_name: string | null
  entry_at: string
  exit_at: string | null
  is_open: boolean
  duration_minutes: number | null
  /** The ENTRY's company number (migration 0106); site visits only. */
  contractor_equipment_code?: string | null
  /** The equipment's owner (`ownership_status`); exposed by the view since 0106. */
  equipment_ownership_status?: string | null
  /**
   * The purpose of the EXIT that closed the visit (migration 0118); `null`
   * for an open visit, a workshop visit and an exit recorded before 0111.
   */
  exit_purpose?: ExitPurpose | null
}

/** Which visits a table lists; `all` applies no context predicate. */
export type VisitsContext = 'site' | 'workshop' | 'all'

/** The `movement_context` value to filter on, or `null` for every context. */
export function visitContextFilter(
  context: VisitsContext,
): 'site' | 'workshop' | null {
  return context === 'all' ? null : context
}

/** Sort keys the visits tab may ask the server for; anything else is ignored. */
export const VISIT_SORT_FIELDS = ['entry_at', 'exit_at'] as const
export type VisitSortField = (typeof VISIT_SORT_FIELDS)[number]

export function visitSortField(
  value: string | null | undefined,
): VisitSortField {
  return VISIT_SORT_FIELDS.includes(value as VisitSortField)
    ? (value as VisitSortField)
    : 'entry_at'
}

/**
 * The `movement_visits` columns the visits search matches, in filter order:
 * the equipment code, type and plate, the driver snapshot, the ENTRY's
 * company number (`contractor_equipment_code`, migration 0106) and, for a
 * digits-only term, the normalized plate digits. The type and the driver are
 * matched through the `*_search` columns of migration 0116. This list is the
 * search itself (`buildVisitSearchFilter`) and the config's `searchFields`.
 */
export const VISIT_SEARCH_FIELDS = [
  'equipment_code',
  'equipment_type_search',
  'equipment_plate_number',
  'driver_name_search',
  'contractor_equipment_code',
  'equipment_plate_digits',
] as const

export const visitsListConfig: DataListConfig = {
  id: 'visits',
  searchPlaceholder: {
    ar: 'البحث بالمعدة (كود او نوع او لوحة) او ترقيم الشركة او السائق',
    en: 'Search by equipment (code, type or plate), company number or driver',
  },
  searchFields: [...VISIT_SEARCH_FIELDS],
  // Newest visit first; `entry_id` breaks ties so paging is deterministic.
  defaultSort: 'entry_at',
  defaultDirection: 'desc',
  // The workshop home exposes no filters: the context is fixed by the role
  // and a workshop visit has no company or project. The foreman home adds
  // those two through `foremanVisitsListConfig` below.
  filterFields: [],
  sortableFields: [
    { key: 'entry_at', label: { ar: 'وقت الدخول', en: 'Entry time' } },
    { key: 'exit_at', label: { ar: 'وقت الخروج', en: 'Exit time' } },
  ],
}

/**
 * Company and project as multi-selects by id (owner request 2026-09-30), the
 * same pattern as the movement log: `in` over the view's `company_id` /
 * `project_id` columns. The options are searched server-side through the
 * screen's `asyncFields` (`useCompanyProjectFilters`), never preloaded.
 */
const VISIT_COMPANY_PROJECT_FILTERS: FilterField[] = [
  {
    key: 'company_id',
    label: 'company',
    type: 'select',
    operators: ['in'],
    options: [],
    multiple: true,
  },
  {
    key: 'project_id',
    label: 'project',
    type: 'select',
    operators: ['in'],
    options: [],
    multiple: true,
  },
]

/**
 * The foreman home's visits tab: the home search and sort plus the company
 * and project filters only. The screen scopes their options to the companies
 * and projects of the foreman's own movements. The workshop home keeps
 * `visitsListConfig`: a workshop visit has neither.
 */
export const foremanVisitsListConfig: DataListConfig = {
  ...visitsListConfig,
  id: 'homeSiteVisits',
  filterFields: VISIT_COMPANY_PROJECT_FILTERS,
}

const VISIT_DATE_OPS: FilterOperator[] = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'between',
  'is_set',
  'is_not_set',
]

/**
 * The visits view of the admin log (`/logs`, admin and monitor only).
 *
 * Same search and sort as the home tab, plus an allowlisted filter set that
 * mirrors the movement log's: every key is a column of `movement_visits`
 * (`equipment_ownership_status` since migration 0106), and the foreman, the
 * company and the project are searched server-side through the screen's async
 * fields (`entry_supervisor_id`, `company_id`, `project_id`) instead of
 * injected options.
 */
export const adminVisitsListConfig: DataListConfig = {
  ...visitsListConfig,
  id: 'logsVisits',
  filterFields: [
    {
      key: 'entry_at',
      label: { ar: 'وقت الدخول', en: 'Entry time' },
      type: 'date',
      operators: VISIT_DATE_OPS,
    },
    {
      key: 'is_open',
      label: 'visitState',
      type: 'select',
      operators: ['eq'],
      options: [
        { value: 'true', label: 'داخل', labelI18n: 'visitOpen' },
        { value: 'false', label: 'انتهت', labelI18n: 'visitClosed' },
      ],
    },
    {
      key: 'equipment_ownership_status',
      label: 'ownershipStatus',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      options: [
        {
          value: 'alazani',
          label: 'العزاني',
          labelI18n: 'adminHomeOwnerAlazani',
        },
        {
          value: 'takween',
          label: 'تكوين',
          labelI18n: 'adminHomeOwnerTakween',
        },
        {
          value: 'third_party_f',
          label: 'طرف ثالث F',
          labelI18n: 'adminHomeOwnerThirdPartyF',
        },
        {
          value: 'third_party_partnership_b',
          label: 'طرف ثالث B',
          labelI18n: 'adminHomeOwnerThirdPartyB',
        },
        {
          value: 'external_supplier',
          label: 'مالك اخر',
          labelI18n: 'adminHomeOwnerExternal',
        },
      ],
    },
    ...VISIT_COMPANY_PROJECT_FILTERS,
    {
      key: 'entry_supervisor_id',
      label: 'logsColForeman',
      type: 'select',
      operators: ['eq', 'neq', 'in', 'not_in'],
      options: [],
    },
    {
      key: 'workshop_purpose',
      label: { ar: 'غرض الورشة', en: 'Workshop purpose' },
      type: 'select',
      operators: ['eq', 'neq', 'is_set', 'is_not_set'],
      options: [
        {
          value: 'maintenance',
          label: 'صيانة',
          labelI18n: 'maintenancePurpose',
        },
        { value: 'parking', label: 'وقوف', labelI18n: 'parkingPurpose' },
      ],
    },
    // The purpose of the EXIT that closed the visit (`exit_purpose`,
    // migration 0118); an open or workshop visit never matches it.
    EXIT_PURPOSE_FILTER_FIELD,
  ],
}

/**
 * Builds the PostgREST `or(...)` filter for a visit search term over
 * `VISIT_SEARCH_FIELDS`, through the shared `buildSearchFilter`.
 *
 * The term is sanitized first (`sanitizeSearchTerm` trims, caps the length and
 * strips the characters that are structural inside `or=(...)`, including the
 * `%` / `_` / `*` wildcards), so nothing here can break out of its pattern.
 * Arabic-Indic digits become ASCII, the `*_search` columns get the normalized
 * term (`normalizeSearchText`, migration 0116), and a digits-only term
 * additionally probes the normalized `plate_digits`.
 * The term is never split into plate letters — that made "a341" match every
 * plate containing an A (see `buildMovementSearchFilter`).
 *
 * Returns `null` when the term is empty after sanitizing.
 */
export function buildVisitSearchFilter(rawTerm: string): string | null {
  return buildSearchFilter(VISIT_SEARCH_FIELDS, rawTerm)
}

export type VisitState = 'open' | 'closed'

export interface VisitStateView {
  state: VisitState
  /** Green while the equipment is still inside, neutral once it has left. */
  tone: 'success' | 'neutral'
  /** Translation key for the badge label. */
  labelKey: 'visitOpen' | 'visitClosed'
}

/**
 * Maps a visit row to its state badge.
 *
 * `is_open` is computed in SQL, but a row is treated as open whenever the exit
 * side is missing for any reason (the EXIT is hidden from this caller by RLS,
 * or a legacy row never got one). The two signals can only disagree if the
 * view and the client drift apart, and "still inside" is the safe reading.
 */
export function visitStateView(
  visit: Pick<EquipmentVisitRow, 'is_open' | 'exit_id' | 'exit_at'>,
): VisitStateView {
  const open = visit.is_open || !visit.exit_id || !visit.exit_at
  return open
    ? { state: 'open', tone: 'success', labelKey: 'visitOpen' }
    : { state: 'closed', tone: 'neutral', labelKey: 'visitClosed' }
}

/**
 * The purpose shown next to a visit's state: the purpose of the EXIT that
 * closed it, only for a closed visit (the same reading as `visitStateView`).
 * `null` for an open visit, a workshop visit and an exit without a purpose.
 */
export function visitExitPurpose(
  visit: Pick<
    EquipmentVisitRow,
    'is_open' | 'exit_id' | 'exit_at' | 'exit_purpose'
  >,
): ExitPurpose | null {
  if (visitStateView(visit).state !== 'closed') return null
  return exitPurposeOrNull(visit.exit_purpose)
}

const ARABIC_UNITS = {
  minute: ['دقيقة', 'دقيقتان', 'دقائق', 'دقيقة'],
  hour: ['ساعة', 'ساعتان', 'ساعات', 'ساعة'],
  day: ['يوم', 'يومان', 'ايام', 'يوما'],
} as const

type DurationUnit = keyof typeof ARABIC_UNITS

const ENGLISH_UNITS: Record<DurationUnit, string> = {
  minute: 'minute',
  hour: 'hour',
  day: 'day',
}

/**
 * Arabic number agreement: 1 is the bare singular, 2 is the dual, 3–10 take
 * the plural, and 11 and up return to the singular. Only the last two forms
 * are printed with the digits, which is how "3 ايام" and "11 يوما" read
 * naturally while "يوم" and "يومان" carry the count in the word itself.
 */
function arabicUnit(count: number, unit: DurationUnit): string {
  const forms = ARABIC_UNITS[unit]
  if (count === 0) return `${count} ${forms[3]}`
  if (count === 1) return forms[0]
  if (count === 2) return forms[1]
  if (count <= 10) return `${count} ${forms[2]}`
  return `${count} ${forms[3]}`
}

function englishUnit(count: number, unit: DurationUnit): string {
  return `${count} ${ENGLISH_UNITS[unit]}${count === 1 ? '' : 's'}`
}

/**
 * Humanises a visit duration that the database already reduced to whole
 * minutes: minutes below an hour, hours below a day, whole days above that.
 * The largest unit alone is enough for the list column — the movement detail
 * is where an exact instant belongs.
 *
 * Returns `null` for a missing or negative duration so the caller renders its
 * own placeholder instead of "0 دقيقة".
 */
export function formatVisitDuration(
  minutes: number | null | undefined,
  lang: Language,
): string | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0)
    return null

  const whole = Math.floor(minutes)
  const unit: DurationUnit =
    whole < 60 ? 'minute' : whole < 60 * 24 ? 'hour' : 'day'
  const count =
    unit === 'minute'
      ? whole
      : unit === 'hour'
        ? Math.floor(whole / 60)
        : Math.floor(whole / (60 * 24))

  return lang === 'ar' ? arabicUnit(count, unit) : englishUnit(count, unit)
}

// ============ VISITS EXPORT ============
//
// The columns of the admin log's visits export. Pure, like the movement
// export in `@/lib/movementExcel`, so the headers and fallbacks can be tested
// without a spreadsheet library; `exportRowsToExcel` writes the sheet. The
// values the view does not carry are looked up at export time through the
// loaders both exports share (`@/lib/exportFields`).

type Translate = (key: TranslationKey) => string

/** The owner cell, shared with the movement export (`exportOwnerLabel`). */
export const visitOwnerLabel = exportOwnerLabel

/** Kept under the visits names the screen and the tests already use. */
export const SUPPLIER_LOOKUP_CHUNK_SIZE = EXPORT_LOOKUP_CHUNK_SIZE
export type EquipmentSupplierRow = EquipmentExportRow
export type VisitDriverChangeRow = DriverChangeRow
export const VISIT_DRIVER_CHANGES_SELECT = DRIVER_CHANGES_SELECT
export { chunkItems, driverMobilesById, supplierNamesByEquipment }
export type { DriverMobileRow }

/** The distinct, non-empty equipment ids of a set of visits, in first-seen order. */
export function distinctEquipmentIds(
  visits: readonly Pick<EquipmentVisitRow, 'equipment_id'>[],
): string[] {
  return distinctIds(visits.map((visit) => visit.equipment_id))
}

/**
 * Visits with their CURRENT driver: the latest auditable driver change of the
 * visit's entry, by `(changed_at, id)`, and the entry's own driver when the
 * visit has no change. The entry row itself is never edited (the original
 * entry driver is immutable), so a driver added to a driverless visit exists
 * only as a change; without this the visit would keep showing no driver.
 */
export function withCurrentDrivers<
  T extends Pick<EquipmentVisitRow, 'entry_id' | 'driver_id' | 'driver_name'>,
>(visits: readonly T[], changes: readonly DriverChangeRow[]): T[] {
  const latest = latestDriverChanges(changes)
  return visits.map((visit) => {
    const change = latest.get(visit.entry_id)
    if (!change?.new_driver_name) return visit
    return {
      ...visit,
      driver_id: change.new_driver_id,
      driver_name: change.new_driver_name,
    }
  })
}

/** The distinct, non-empty driver ids of a set of visits, in first-seen order. */
export function distinctDriverIds(
  visits: readonly Pick<EquipmentVisitRow, 'driver_id'>[],
): string[] {
  return distinctIds(visits.map((visit) => visit.driver_id))
}

/** The entry ids whose driver can have changed: site visits only. */
export function siteEntryIds(
  visits: readonly Pick<EquipmentVisitRow, 'entry_id' | 'movement_context'>[],
): string[] {
  return visits
    .filter((visit) => visit.movement_context === 'site')
    .map((visit) => visit.entry_id)
}

/** The workshop purpose in words; empty for a site row or an unclassified one. */
function workshopPurposeLabel(
  row: Pick<EquipmentVisitRow, 'movement_context' | 'workshop_purpose'>,
  t: Translate,
): string {
  if (row.movement_context !== 'workshop') return ''
  if (row.workshop_purpose === 'maintenance') return t('maintenancePurpose')
  if (row.workshop_purpose === 'parking') return t('parkingPurpose')
  return ''
}

/** The context cell: المشاريع, or the workshop with its purpose spelled out. */
function visitContextLabel(
  row: Pick<EquipmentVisitRow, 'movement_context' | 'workshop_purpose'>,
  t: Translate,
): string {
  if (row.movement_context !== 'workshop') return t('logsSites')
  return workshopPurposeLabel(row, t) || t('logsWorkshop')
}

/**
 * Every field of a visit, grouped for the export dialog: the equipment, the
 * visit, the company and project (Arabic and English as separate columns),
 * the driver, then who recorded it and when.
 *
 * @param lookups the values resolved at export time: the supplier and the
 * chassis number by equipment, the mobile by (current) driver and the exit
 * supervisor's name by profile. Without them those cells export empty, which
 * is how the dialog builds its checklist before any row is read.
 */
export function visitExportColumns(
  t: Translate,
  lang: Language,
  lookups: ExportLookups = {},
): ExcelColumn<EquipmentVisitRow>[] {
  const equipment = t('exportGroupEquipment')
  const visit = t('exportGroupVisit')
  const companyProject = t('exportGroupCompanyProject')
  const driver = t('exportGroupDriver')
  const recording = t('exportGroupRecording')
  return [
    {
      key: 'equipment_code',
      mandatory: true,
      group: equipment,
      header: t('equipmentCodeLabel'),
      width: 14,
      value: (row) => row.equipment_code ?? '',
    },
    {
      key: 'equipment_type',
      mandatory: true,
      group: equipment,
      header: t('equipmentType'),
      width: 24,
      value: (row) => row.equipment_type ?? '',
    },
    {
      key: 'plate_number',
      mandatory: true,
      group: equipment,
      header: t('plateNumber'),
      width: 14,
      value: (row) => row.equipment_plate_number ?? '',
    },
    {
      // Looked up at export time: `movement_visits` has no chassis column.
      key: 'chassis_number',
      group: equipment,
      header: t('chassisNumber'),
      width: 20,
      value: (row) => lookupValue(lookups.chassisByEquipment, row.equipment_id),
    },
    {
      key: 'owner',
      group: equipment,
      header: t('ownershipStatus'),
      width: 16,
      value: (row) => exportOwnerLabel(row.equipment_ownership_status, t),
    },
    {
      key: 'supplier',
      group: equipment,
      header: t('lessor'),
      width: 24,
      value: (row) =>
        lookupValue(lookups.supplierByEquipment, row.equipment_id),
    },
    {
      key: 'contractor_code',
      group: equipment,
      header: t('contractorEquipmentCode'),
      width: 16,
      value: (row) => row.contractor_equipment_code ?? '',
    },
    {
      key: 'context',
      group: visit,
      header: t('logsColContext'),
      width: 14,
      value: (row) => visitContextLabel(row, t),
    },
    {
      // The context already names the purpose; this column holds it alone,
      // so the sheet can be filtered on it. Empty for a site visit.
      key: 'workshop_purpose',
      group: visit,
      header: t('exportColWorkshopPurpose'),
      width: 14,
      value: (row) => workshopPurposeLabel(row, t),
    },
    {
      key: 'visit_state',
      mandatory: true,
      group: visit,
      header: t('visitState'),
      width: 10,
      value: (row) => t(visitStateView(row).labelKey),
    },
    {
      // Right after the state: the purpose of the EXIT that closed the visit,
      // empty for an open, workshop or pre-0111 visit.
      key: 'exit_purpose',
      group: visit,
      header: t('exitPurpose'),
      width: 14,
      value: (row) => exitPurposeExportLabel(visitExitPurpose(row), t),
    },
    {
      key: 'company_ar',
      group: companyProject,
      header: t('companyNameAr'),
      width: 24,
      value: (row) => exportText(row.company_name_ar),
    },
    {
      key: 'company_en',
      group: companyProject,
      header: t('companyNameEn'),
      width: 24,
      value: (row) => exportText(row.company_name_en),
    },
    {
      key: 'project_ar',
      group: companyProject,
      header: t('projectNameAr'),
      width: 24,
      value: (row) => exportText(row.project_name_ar),
    },
    {
      key: 'project_en',
      group: companyProject,
      header: t('projectNameEn'),
      width: 24,
      value: (row) => exportText(row.project_name_en),
    },
    {
      key: 'driver_name',
      group: driver,
      header: t('driverName'),
      width: 22,
      value: (row) => row.driver_name ?? '',
    },
    {
      key: 'driver_mobile',
      group: driver,
      header: t('exportColDriverMobile'),
      width: 16,
      // Text, so a leading zero survives in the sheet.
      value: (row) => lookupValue(lookups.mobileByDriver, row.driver_id),
    },
    {
      key: 'entry_by',
      group: recording,
      header: t('entryBy'),
      width: 22,
      value: (row) => row.entry_supervisor_name ?? '',
    },
    {
      // The view carries the exit recorder's id only; the name is looked up
      // through `profile_names` at export time. Empty for an open visit.
      key: 'exit_by',
      group: recording,
      header: t('exitBy'),
      width: 22,
      value: (row) =>
        visitStateView(row).state === 'closed'
          ? lookupValue(lookups.nameByProfile, row.exit_supervisor_id)
          : '',
    },
    {
      key: 'entry_at',
      mandatory: true,
      group: recording,
      header: t('visitEntryAt'),
      width: 18,
      type: 'date',
      value: (row) => row.entry_at ?? null,
    },
    {
      key: 'exit_at',
      group: recording,
      header: t('visitExitAt'),
      width: 18,
      type: 'date',
      // Only a visible, paired EXIT has an end instant (see visitStateView).
      value: (row) =>
        visitStateView(row).state === 'closed' ? row.exit_at : null,
    },
    {
      key: 'duration',
      group: recording,
      header: t('visitDuration'),
      width: 14,
      value: (row) => formatVisitDuration(row.duration_minutes, lang) ?? '',
    },
  ]
}

/**
 * `visits-<context>-<yyyymmdd>.xlsx`, dated by the Saudi calendar day like the
 * movement export next to it.
 */
export function visitExportFileName(
  context: VisitsContext,
  now: Date | string = new Date(),
): string {
  return `visits-${context}-${saudiDateKey(now).replace(/-/g, '')}.xlsx`
}
