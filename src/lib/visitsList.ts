import { saudiDateKey } from '@/lib/saudiTime'
import { buildSearchFilter } from '@/lib/search'
import type { Language, TranslationKey } from '@/i18n/translations'
import type {
  DataListConfig,
  FilterField,
  FilterOperator,
} from '@/components/data-list/types'
import type { ExcelColumn } from '@/lib/excel'

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
 * that migration must be applied before this select is shipped.
 */
export const EQUIPMENT_VISITS_SELECT =
  'entry_id,exit_id,equipment_id,equipment_code,equipment_type,equipment_plate_number,movement_context,workshop_purpose,company_id,company_name_ar,company_name_en,project_id,project_name_ar,project_name_en,entry_supervisor_id,entry_supervisor_name,exit_supervisor_id,driver_id,driver_name,entry_at,exit_at,is_open,duration_minutes,contractor_equipment_code,equipment_ownership_status'

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
// without a spreadsheet library; `exportRowsToExcel` writes the sheet.

type Translate = (key: TranslationKey) => string

/** A localized name for a sheet cell: empty, never an em dash. */
function exportName(
  lang: Language,
  nameAr?: string | null,
  nameEn?: string | null,
): string {
  const preferred = lang === 'ar' ? nameAr : nameEn
  const fallback = lang === 'ar' ? nameEn : nameAr
  return preferred?.trim() || fallback?.trim() || ''
}

/** Short owner labels, the same keys the owner filter above offers. */
const OWNER_LABEL_KEYS: Record<string, TranslationKey> = {
  alazani: 'adminHomeOwnerAlazani',
  takween: 'adminHomeOwnerTakween',
  third_party_f: 'adminHomeOwnerThirdPartyF',
  third_party_partnership_b: 'adminHomeOwnerThirdPartyB',
  external_supplier: 'adminHomeOwnerExternal',
}

/**
 * The owner cell: the localized owner name, the raw value for an owner the app
 * does not know yet (never blank), and empty when the view returned none.
 */
export function visitOwnerLabel(
  status: string | null | undefined,
  t: Translate,
): string {
  if (!status) return ''
  const key = OWNER_LABEL_KEYS[status]
  return key ? t(key) : status
}

/** Equipment ids are looked up this many per request, so a URL stays short. */
export const SUPPLIER_LOOKUP_CHUNK_SIZE = 100

/** Splits a list into consecutive chunks of at most `size` (at least one). */
export function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.trunc(size))
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += step)
    chunks.push(items.slice(index, index + step))
  return chunks
}

/** The distinct, non-empty equipment ids of a set of visits, in first-seen order. */
export function distinctEquipmentIds(
  visits: readonly Pick<EquipmentVisitRow, 'equipment_id'>[],
): string[] {
  return Array.from(
    new Set(
      visits
        .map((visit) => visit.equipment_id)
        .filter((id): id is string => !!id),
    ),
  )
}

/** One `equipment` row as the supplier lookup selects it. */
export interface EquipmentSupplierRow {
  id: string
  /** PostgREST returns an embedded to-one row as an object (or null). */
  lessor?: { name: string | null } | { name: string | null }[] | null
}

/**
 * Maps equipment id to supplier (lessor) name. A unit without a lessor, or a
 * lessor without a name, is simply absent, so its cell exports empty.
 */
export function supplierNamesByEquipment(
  rows: readonly EquipmentSupplierRow[],
  into: Map<string, string> = new Map(),
): Map<string, string> {
  for (const row of rows) {
    const lessor = Array.isArray(row.lessor) ? row.lessor[0] : row.lessor
    const name = lessor?.name?.trim()
    if (row.id && name) into.set(row.id, name)
  }
  return into
}

/**
 * @param supplierByEquipment supplier names resolved at export time (the view
 * does not carry them); a unit absent from the map exports an empty supplier.
 */
export function visitExportColumns(
  t: Translate,
  lang: Language,
  supplierByEquipment: ReadonlyMap<string, string> = new Map(),
): ExcelColumn<EquipmentVisitRow>[] {
  return [
    {
      header: t('equipmentCodeLabel'),
      width: 14,
      value: (row) => row.equipment_code ?? '',
    },
    {
      header: t('equipmentType'),
      width: 24,
      value: (row) => row.equipment_type ?? '',
    },
    {
      header: t('plateNumber'),
      width: 14,
      value: (row) => row.equipment_plate_number ?? '',
    },
    {
      header: t('ownershipStatus'),
      width: 16,
      value: (row) => visitOwnerLabel(row.equipment_ownership_status, t),
    },
    {
      header: t('lessor'),
      width: 24,
      value: (row) => supplierByEquipment.get(row.equipment_id) ?? '',
    },
    {
      header: t('contractorEquipmentCode'),
      width: 16,
      value: (row) => row.contractor_equipment_code ?? '',
    },
    {
      header: t('logsColContext'),
      width: 14,
      value: (row) => {
        if (row.movement_context !== 'workshop') return t('logsSites')
        if (row.workshop_purpose === 'maintenance')
          return t('maintenancePurpose')
        if (row.workshop_purpose === 'parking') return t('parkingPurpose')
        return t('logsWorkshop')
      },
    },
    {
      header: t('visitState'),
      width: 10,
      value: (row) => t(visitStateView(row).labelKey),
    },
    {
      header: t('company'),
      width: 24,
      value: (row) =>
        exportName(lang, row.company_name_ar, row.company_name_en),
    },
    {
      header: t('project'),
      width: 24,
      value: (row) =>
        exportName(lang, row.project_name_ar, row.project_name_en),
    },
    {
      header: t('driverName'),
      width: 22,
      value: (row) => row.driver_name ?? '',
    },
    {
      header: t('entryBy'),
      width: 22,
      value: (row) => row.entry_supervisor_name ?? '',
    },
    {
      header: t('visitEntryAt'),
      width: 18,
      type: 'date',
      value: (row) => row.entry_at ?? null,
    },
    {
      header: t('visitExitAt'),
      width: 18,
      type: 'date',
      // Only a visible, paired EXIT has an end instant (see visitStateView).
      value: (row) =>
        visitStateView(row).state === 'closed' ? row.exit_at : null,
    },
    {
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
