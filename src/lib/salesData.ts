import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import type { CompanyProjectSource } from '@/lib/companyProject'
import {
  type EquipmentCardRef,
  type NamedRef,
  type PartyVisit,
  PURCHASING_UNIT_SELECT,
  type RpcResult,
} from '@/lib/purchasingData'
import {
  clientPoEquipmentPayload,
  monthStartOf,
  type CardMonthBatchItem,
  type CardPriceBatchItem,
  type CardPricingStatus,
  type ClientPoCreateLine,
  type ClientPoEventType,
  type ClientPoFormValues,
  type ClientPoStatus,
  type EquipmentCardEventType,
  type SaleRateUnit,
} from '@/lib/sales'
import { saudiDateKey, saudiDayStart } from '@/lib/saudiTime'
import { buildSearchFilter } from '@/lib/search'
import { latestVisitPerUnit, recentVisitOrClause } from '@/lib/siteVisits'
import { supabase } from '@/lib/supabase'
import { unwrapRows } from '@/lib/supabaseResult'
import type { OwnershipStatus } from '@/lib/types'

/**
 * sales-screens — the DATA side of the sales phase-1 screens (migration
 * 0169): the rows the screens select, the five write functions they call
 * and the small derivations on top of them. Every read goes through
 * PostgREST with the signed-in user's token (RLS: `sales.view`; the
 * supplier side of a card needs `purchasing.view`), every write through the
 * SECURITY DEFINER functions of 0169 (RLS has no insert / update policy on
 * the sales tables), so the database stays authoritative. The pure labels
 * and the token → field mapping live in `src/lib/sales.ts`.
 *
 * Phase 2 («كروت التشغيل», migration 0172) adds, at the end: the rows of
 * `sales_card_months` / `sales_card_month_slots` and `equipment_card_events`,
 * the bounded reads of the batch screen and the three month functions.
 */

// --- Rows --------------------------------------------------------------------

/** `client_pos` with its embeds and, on the list, the line count. */
export interface ClientPoRow {
  id: string
  /** The CLIENT's own PO number, as received. */
  po_number: string
  company_id: string
  project_id: string
  issue_date: string
  expiry_date: string | null
  standard_hours: number
  status: ClientPoStatus
  closed_at: string | null
  closed_by: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  /** The computed column `unpriced_count(client_pos)`. */
  unpriced_count?: number | null
  company: NamedRef | null
  project: NamedRef | null
  /** PostgREST count embed: `client_po_equipment(count)`. */
  client_po_equipment?: { count: number }[] | null
}

/** `client_po_equipment` joined through its card. */
export interface ClientPoLineRow {
  id: string
  client_po_id: string
  equipment_card_id: string
  /** NULL while the sale price is still to be entered. */
  price: number | null
  rate_unit: SaleRateUnit
  standard_hours: number
  /** The contract quantity in the line's unit, or NULL (no ceiling). */
  quantity: number | null
  note: string | null
  created_at: string
  updated_at: string
  card: EquipmentCardRef | null
}

export interface ClientPoEventRow {
  id: string
  client_po_id: string
  event_type: ClientPoEventType
  payload: Record<string, unknown> | null
  actor_id: string | null
  /** The actor's name as it was when the event was written. */
  actor_name: string | null
  created_at: string
  /** Insertion order within one created_at. */
  seq?: number | null
}

/** One line of the equipment page's sales card: the line with its PO. */
export interface EquipmentSalesRow extends ClientPoLineRow {
  po: ClientPoRow | null
}

/**
 * One unit on a client PO (`sales_po_units`): a line flattened with its PO,
 * the PO's company and project, the unit, its card period and the supplier
 * side of the same card (NULL for a reader without `purchasing.view`). The
 * «حسب المعدات» view of the client PO list.
 */
export interface SalesPoUnitRow {
  line_id: string
  price: number | null
  rate_unit: SaleRateUnit
  standard_hours: number
  quantity: number | null
  line_note: string | null
  line_created_at: string
  updated_at: string
  is_priced: boolean
  client_po_id: string
  po_number: string
  po_status: ClientPoStatus
  issue_date: string
  expiry_date: string | null
  po_standard_hours: number
  company_id: string | null
  company_name_ar: string | null
  company_name_en: string | null
  project_id: string | null
  project_name_ar: string | null
  project_name_en: string | null
  equipment_card_id: string
  equipment_id: string
  equipment_code: string | null
  equipment_type: string | null
  equipment_plate_number: string | null
  equipment_chassis_number: string | null
  equipment_ownership_status: OwnershipStatus | null
  equipment_lessor_id: string | null
  equipment_lessor_name: string | null
  supplier_po_id: string | null
  supplier_po_number: string | null
  supplier_price: number | null
  /** 0185: any of the four units (the purchasing type still names two). */
  supplier_rate_unit: SaleRateUnit | null
}

/** Only what the «حسب المعدات» table shows and its row opens. */
export const SALES_PO_UNITS_SELECT =
  'line_id,price,rate_unit,standard_hours,quantity,line_note,line_created_at,updated_at,is_priced,client_po_id,po_number,po_status,issue_date,expiry_date,po_standard_hours,company_id,company_name_ar,company_name_en,project_id,project_name_ar,project_name_en,equipment_card_id,equipment_id,equipment_code,equipment_type,equipment_plate_number,equipment_chassis_number,equipment_ownership_status,equipment_lessor_id,equipment_lessor_name,supplier_po_id,supplier_po_number,supplier_price,supplier_rate_unit'

/**
 * One «كرت المعدة» with both sides (`sales_equipment_cards`): the unit, the
 * company and project, the entry it was created from (its visit; a card has
 * no period and no open / ended state since 0189), the client PO line (the
 * open PO's first, else the latest) and the supplier PO line (the line of
 * the card's latest supplier PO).
 */
export interface SalesEquipmentCardRow {
  card_id: string
  equipment_id: string
  company_id: string
  project_id: string
  rate_unit: string
  standard_hours: number
  note: string | null
  entry_log_id: string | null
  entry_at: string | null
  created_at: string
  updated_at: string
  equipment_code: string | null
  equipment_type: string | null
  equipment_plate_number: string | null
  equipment_chassis_number: string | null
  equipment_ownership_status: OwnershipStatus | null
  equipment_lessor_id: string | null
  equipment_lessor_name: string | null
  company_name_ar: string | null
  company_name_en: string | null
  project_name_ar: string | null
  project_name_en: string | null
  client_line_id: string | null
  client_po_id: string | null
  client_po_number: string | null
  client_po_status: ClientPoStatus | null
  client_price: number | null
  client_rate_unit: SaleRateUnit | null
  client_standard_hours: number | null
  client_quantity: number | null
  has_client_po: boolean
  supplier_line_id: string | null
  supplier_po_id: string | null
  supplier_po_number: string | null
  supplier_price: number | null
  /** 0185: any of the four units (the purchasing type still names two). */
  supplier_rate_unit: SaleRateUnit | null
  has_supplier_po: boolean
  // 0174: the card's own client price («اسعار المعدات») and its approval.
  card_client_price: number | null
  pricing_status: CardPricingStatus
  pricing_approved_at: string | null
  pricing_approved_by: string | null
  pricing_approved_by_name: string | null
  card_margin: number | null
  card_margin_pct: number | null
  supplier_po_approval_status: string | null
  /** 0185: the unit of `card_client_price` (month for every earlier card). */
  card_client_price_unit: SaleRateUnit
}

/** The 0174 trailing columns of `sales_equipment_cards` (and the 0185
 *  unit of the card's client price). */
export const CARD_PRICING_COLUMNS =
  'card_client_price,pricing_status,pricing_approved_at,pricing_approved_by,pricing_approved_by_name,card_margin,card_margin_pct,supplier_po_approval_status,card_client_price_unit'

/** Every column of the view the cards list and the card page show. */
export const EQUIPMENT_CARDS_SELECT = `card_id,equipment_id,company_id,project_id,rate_unit,standard_hours,note,entry_log_id,entry_at,created_at,updated_at,equipment_code,equipment_type,equipment_plate_number,equipment_chassis_number,equipment_ownership_status,equipment_lessor_id,equipment_lessor_name,company_name_ar,company_name_en,project_name_ar,project_name_en,client_line_id,client_po_id,client_po_number,client_po_status,client_price,client_rate_unit,client_standard_hours,client_quantity,has_client_po,supplier_line_id,supplier_po_id,supplier_po_number,supplier_price,supplier_rate_unit,has_supplier_po,${CARD_PRICING_COLUMNS}`

/**
 * One row of «اسعار المعدات» (`sales_equipment_cards` WHERE supplier_line_id
 * IS NOT NULL): the unit, the company and project, the supplier side and
 * the card's own pricing. Only what the page shows.
 */
export type CardPriceRow = Pick<
  SalesEquipmentCardRow,
  | 'card_id'
  | 'equipment_id'
  | 'company_id'
  | 'project_id'
  | 'equipment_code'
  | 'equipment_type'
  | 'equipment_plate_number'
  | 'equipment_chassis_number'
  | 'equipment_ownership_status'
  | 'equipment_lessor_id'
  | 'equipment_lessor_name'
  | 'company_name_ar'
  | 'company_name_en'
  | 'project_name_ar'
  | 'project_name_en'
  | 'supplier_line_id'
  | 'supplier_po_id'
  | 'supplier_po_number'
  | 'supplier_price'
  | 'supplier_rate_unit'
  | 'card_client_price'
  | 'pricing_status'
  | 'pricing_approved_at'
  | 'pricing_approved_by'
  | 'pricing_approved_by_name'
  | 'card_margin'
  | 'card_margin_pct'
  | 'supplier_po_approval_status'
  | 'card_client_price_unit'
> & {
  /**
   * 0184: the latest of the card's, the client PO's and the supplier PO's
   * `updated_at` — the page's default sort (newest first).
   */
  last_modified_at: string
}

export const CARD_PRICES_SELECT = `card_id,equipment_id,company_id,project_id,equipment_code,equipment_type,equipment_plate_number,equipment_chassis_number,equipment_ownership_status,equipment_lessor_id,equipment_lessor_name,company_name_ar,company_name_en,project_name_ar,project_name_en,supplier_line_id,supplier_po_id,supplier_po_number,supplier_price,supplier_rate_unit,${CARD_PRICING_COLUMNS},last_modified_at`

/** The movement facts of a card's entry (`movement_visits`). */
export interface CardVisitRow {
  entry_id: string
  exit_id: string | null
  entry_at: string
  exit_at: string | null
  is_open: boolean
  entry_supervisor_name: string | null
  driver_full_name: string | null
  driver_name: string | null
}

export const CARD_VISIT_SELECT =
  'entry_id,exit_id,entry_at,exit_at,is_open,entry_supervisor_name,driver_full_name,driver_name'

// --- Selects -----------------------------------------------------------------

const NAMED = 'id,name_ar,name_en'

export const CLIENT_PO_SELECT = `id,po_number,company_id,project_id,issue_date,expiry_date,standard_hours,status,closed_at,closed_by,notes,created_by,created_at,updated_at,unpriced_count,company:companies(${NAMED}),project:projects(${NAMED})`

/** The list adds the line count (one embedded count per row). */
export const CLIENT_PO_LIST_SELECT = `${CLIENT_PO_SELECT},client_po_equipment(count)`

export const CLIENT_PO_LINE_SELECT = `id,client_po_id,equipment_card_id,price,rate_unit,standard_hours,quantity,note,created_at,updated_at,card:equipment_cards(id,equipment_id,entry_log_id,equipment:equipment(${PURCHASING_UNIT_SELECT}))`

export const CLIENT_PO_EVENT_SELECT =
  'id,client_po_id,event_type,payload,actor_id,actor_name,created_at,seq'

/** The equipment page shows the unit's lines with their POs, the latest
 *  issue date first. */
export const EQUIPMENT_SALES_SELECT = `id,client_po_id,equipment_card_id,price,rate_unit,standard_hours,quantity,note,created_at,updated_at,card:equipment_cards!inner(id,equipment_id,equipment:equipment(${PURCHASING_UNIT_SELECT})),po:client_pos(${CLIENT_PO_SELECT})`

/** The equipment page shows this many sales lines at most. */
export const EQUIPMENT_SALES_LIMIT = 10

// --- Derivations ---------------------------------------------------------------

/** The line count of a list row (0 when the embed is missing). */
export function clientPoLineCount(row: ClientPoRow): number {
  return row.client_po_equipment?.[0]?.count ?? 0
}

/** The PO row as the shared company / project cell reads it. */
export function clientPoCompanyProject(
  po: Pick<ClientPoRow, 'company_id' | 'project_id' | 'company' | 'project'>,
): CompanyProjectSource {
  return {
    company_id: po.company_id,
    company_name_ar: po.company?.name_ar ?? null,
    company_name_en: po.company?.name_en ?? null,
    project_id: po.project_id,
    project_name_ar: po.project?.name_ar ?? null,
    project_name_en: po.project?.name_en ?? null,
  }
}

// --- Reads ---------------------------------------------------------------------

/** The visit columns the sales pickers search (the purchasing ones). */
const VISIT_SEARCH_FIELDS = [
  'equipment_code',
  'equipment_type_search',
  'equipment_plate_number',
  'equipment_plate_digits',
] as const

const VISIT_SELECT =
  'entry_id,equipment_id,equipment_code,equipment_type,equipment_plate_number,entry_at,exit_at,company_id,company_name_ar,company_name_en,project_id,project_name_ar,project_name_en'

/**
 * Every site visit (`movement_visits`), whatever the unit's owner, inside a
 * project now OR exited within the last 60 Saudi days (0188, owner
 * 2026-11-09: a unit that entered and left within a day can join a PO).
 */
function recentSiteVisits() {
  return supabase
    .from('movement_visits')
    .select(VISIT_SELECT)
    .eq('movement_context', 'site')
    .or(recentVisitOrClause())
}

/** A page of visits; the loop below reads them all. */
export const RECENT_VISITS_PAGE = 500

/**
 * Every unit inside a project now or exited from it within 60 days (0188),
 * one visit per unit and project (`latestVisitPerUnit`: the open one, else
 * the latest — the visit `add_client_po_equipment` picks), grouped by the
 * create dialog into the companies (and under each, the projects) and the
 * units of the chosen project. ALL of them, read page by page by equipment
 * code then entry (the purchasing lesson of 2026-10-31: a single capped
 * request dropped units).
 */
export async function fetchRecentSiteVisits(): Promise<PartyVisit[]> {
  const rows: PartyVisit[] = []
  for (let from = 0; ; from += RECENT_VISITS_PAGE) {
    const page = unwrapRows<PartyVisit>(
      await recentSiteVisits()
        .order('equipment_code')
        .order('entry_id')
        .range(from, from + RECENT_VISITS_PAGE - 1),
    )
    rows.push(...page)
    if (page.length < RECENT_VISITS_PAGE) return latestVisitPerUnit(rows)
  }
}

/**
 * «اضافة معدة» on a client PO (the 0169 join rule, widened by 0188): the
 * units with a site visit of the PO's company and project, inside now or
 * exited within the last 60 Saudi days, one option per unit (an exited one
 * marked with `exitedLabel`), first 20 by code; no entry-day rule on the
 * client side. The database re-checks in `add_client_po_equipment`.
 */
export function equipmentAtClientProjectOptionLoader(
  companyId: string,
  projectId: string,
  options: {
    excludeEquipmentIds?: readonly string[]
    exitedLabel?: string
  } = {},
): (query: string) => Promise<AsyncSearchSelectOption[]> {
  const excluded = options.excludeEquipmentIds ?? []
  return async (query) => {
    let request = recentSiteVisits()
      .eq('company_id', companyId)
      .eq('project_id', projectId)
      .order('equipment_code')
      // The open visit of a unit first, then its latest exit.
      .order('exit_at', { ascending: false, nullsFirst: true })
      .limit(20)
    // Units already on the PO are not offered again.
    if (excluded.length)
      request = request.not('equipment_id', 'in', `(${excluded.join(',')})`)
    const searchFilter = buildSearchFilter(VISIT_SEARCH_FIELDS, query)
    if (searchFilter) request = request.or(searchFilter)
    const seen = new Set<string>()
    return unwrapRows<PartyVisit>(await request)
      .filter((visit) => {
        if (seen.has(visit.equipment_id)) return false
        seen.add(visit.equipment_id)
        return true
      })
      .map((visit) => ({
        value: visit.equipment_id,
        label: visit.equipment_code,
        description: [
          visit.equipment_type,
          visit.equipment_plate_number,
          visit.exit_at ? options.exitedLabel : null,
        ]
          .filter(Boolean)
          .join(' · '),
      }))
  }
}

// --- Writes (the five functions of 0169) --------------------------------------------

function asResult<T>(result: {
  data: unknown
  error: {
    code?: string
    message: string
    details?: string
    hint?: string
  } | null
}): RpcResult<T> {
  if (result.error)
    return {
      data: null,
      error: {
        code: result.error.code,
        message: result.error.message,
        details: result.error.details,
        hint: result.error.hint,
      },
    }
  return { data: result.data as T, error: null }
}

/** `create_client_po`: the PO and its lines in one call; returns the id. */
export async function createClientPo(
  values: ClientPoFormValues,
  lines: readonly ClientPoCreateLine[] = [],
): Promise<RpcResult<string>> {
  return asResult<string>(
    await supabase.rpc('create_client_po', {
      p_company_id: values.company_id,
      p_project_id: values.project_id,
      p_po_number: values.po_number.trim(),
      p_issue_date: values.issue_date,
      p_expiry_date: values.expiry_date || null,
      p_standard_hours: values.standard_hours.trim()
        ? Number(values.standard_hours.trim())
        : null,
      p_notes: values.notes.trim() || null,
      p_equipment: clientPoEquipmentPayload(lines),
    }),
  )
}

/** `add_client_po_equipment`: returns the new line id. */
export async function addClientPoEquipment(input: {
  poId: string
  equipmentId: string
  /** null = «تحتاج سعر». */
  price: number | null
  rateUnit: SaleRateUnit
  /** null = the PO's default. */
  standardHours: number | null
  /** null = no ceiling. */
  quantity: number | null
  note: string
}): Promise<RpcResult<string>> {
  return asResult<string>(
    await supabase.rpc('add_client_po_equipment', {
      p_client_po_id: input.poId,
      p_equipment_id: input.equipmentId,
      p_price: input.price,
      p_rate_unit: input.rateUnit,
      p_standard_hours: input.standardHours,
      p_quantity: input.quantity,
      p_note: input.note.trim() || null,
    }),
  )
}

/** `update_client_po`: the dates and the notes of an open PO. */
export async function updateClientPo(input: {
  poId: string
  issueDate: string
  /** Empty = no expiry. */
  expiryDate: string
  notes: string
}): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('update_client_po', {
      p_client_po_id: input.poId,
      p_issue_date: input.issueDate,
      p_expiry_date: input.expiryDate || null,
      p_notes: input.notes.trim() || null,
    }),
  )
}

/** `update_client_po_equipment`: the price (null = unpriced), the unit,
 *  the standard hours, the quantity (null = no ceiling) and the note. */
export async function updateClientPoEquipment(input: {
  lineId: string
  price: number | null
  rateUnit: SaleRateUnit
  standardHours: number | null
  quantity: number | null
  note: string
}): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('update_client_po_equipment', {
      p_line_id: input.lineId,
      p_price: input.price,
      p_rate_unit: input.rateUnit,
      p_standard_hours: input.standardHours,
      p_quantity: input.quantity,
      p_note: input.note.trim() || null,
    }),
  )
}

/** `close_client_po`. */
export async function closeClientPo(poId: string): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('close_client_po', { p_client_po_id: poId }),
  )
}

// ===================================================================================
// Phase 2 — «كروت التشغيل»: the months of a card (migration 0172)
// ===================================================================================

// --- Rows --------------------------------------------------------------------

/**
 * One month of a card as both 0172 views expose it: the record (null while
 * a slot is not recorded), the card and unit facts of `sales_equipment_cards`,
 * both PO lines and the computed amounts. `slot_id`, `recorded` and
 * `month_id` exist on `sales_card_month_slots` only.
 */
export interface CardMonthSlotRow {
  slot_id: string
  /** The first day of the Saudi month. */
  month: string
  recorded: boolean
  month_id: string | null
  hours: number | string | null
  /** 0185: the recorded days (NULL while not recorded or none). */
  days: number | string | null
  /** 0185: the distinct Saudi days of the month the unit was inside the
   *  card's company and project (0 without the movement rights). */
  presence_days: number | null
  note: string | null
  card_id: string
  equipment_id: string
  company_id: string
  project_id: string
  /** 0189: the card's visit (it has no period): the entry and the exit that
   *  closes it, NULL while the unit is inside. */
  entry_at: string | null
  exit_at: string | null
  standard_hours: number
  equipment_code: string | null
  equipment_type: string | null
  equipment_plate_number: string | null
  equipment_chassis_number: string | null
  equipment_ownership_status: OwnershipStatus | null
  owned: boolean
  company_name_ar: string | null
  company_name_en: string | null
  project_name_ar: string | null
  project_name_en: string | null
  client_line_id: string | null
  client_po_id: string | null
  client_po_number: string | null
  client_price: number | string | null
  client_rate_unit: SaleRateUnit | null
  client_standard_hours: number | null
  supplier_line_id: string | null
  supplier_po_id: string | null
  supplier_po_number: string | null
  supplier_price: number | string | null
  /** 0185: any of the four units (the purchasing type still names two). */
  supplier_rate_unit: SaleRateUnit | null
  due_standard_hours: number | null
  client_due: number | string | null
  supplier_due: number | string | null
  margin: number | string | null
}

/** The slot columns the «الشهور» list and the batch screen show. */
export const CARD_MONTH_SLOTS_SELECT =
  'slot_id,month,recorded,month_id,hours,days,presence_days,note,card_id,equipment_id,company_id,project_id,entry_at,exit_at,standard_hours,equipment_code,equipment_type,equipment_plate_number,equipment_chassis_number,equipment_ownership_status,owned,company_name_ar,company_name_en,project_name_ar,project_name_en,client_line_id,client_po_id,client_po_number,client_price,client_rate_unit,client_standard_hours,supplier_line_id,supplier_po_id,supplier_po_number,supplier_price,supplier_rate_unit,due_standard_hours,client_due,supplier_due,margin'

/** One RECORDED month of a card (`sales_card_months`), as the card page
 *  lists it: the card's facts are already on the page, so only the record
 *  and its amounts are selected. */
export interface CardMonthRecordRow {
  id: string
  month: string
  hours: number | string
  /** 0185: the recorded days, or NULL. */
  days: number | string | null
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  card_id: string
  due_standard_hours: number | null
  client_due: number | string | null
  supplier_due: number | string | null
  margin: number | string | null
}

export const CARD_MONTHS_SELECT =
  'id,month,hours,days,note,created_by,created_at,updated_at,card_id,due_standard_hours,client_due,supplier_due,margin'

/** The months of one card the page shows at most (ten years). */
export const CARD_MONTHS_LIMIT = 120

/** A pending slot of the card page: the month and the exit of the card's
 *  visit (0189; the running month of a unit still inside is «جاري», not
 *  «بانتظار»). */
export interface CardPendingSlotRow {
  slot_id: string
  month: string
  recorded: boolean
  exit_at: string | null
  /** 0185: the dialog prefills the days of a new month with it. */
  presence_days: number | null
}

export const CARD_PENDING_SLOTS_SELECT =
  'slot_id,month,recorded,exit_at,presence_days'

/** `equipment_card_events`: the card's own append-only audit (0172). */
export interface EquipmentCardEventRow {
  id: string
  seq: number
  equipment_card_id: string
  event_type: EquipmentCardEventType
  payload: Record<string, unknown> | null
  actor_id: string | null
  /** The actor's name as it was when the event was written. */
  actor_name: string | null
  created_at: string
}

export const EQUIPMENT_CARD_EVENT_SELECT =
  'id,seq,equipment_card_id,event_type,payload,actor_id,actor_name,created_at'

/** A company and project a card sits in (the batch screen's pickers). */
export interface CardPlaceRow {
  card_id: string
  company_id: string
  company_name_ar: string | null
  company_name_en: string | null
  project_id: string
  project_name_ar: string | null
  project_name_en: string | null
}

export const CARD_PLACES_SELECT =
  'card_id,company_id,company_name_ar,company_name_en,project_id,project_name_ar,project_name_en'

/** At most this many cards feed the batch screen's pickers. */
export const CARD_PLACES_LIMIT = 1000

/** At most this many cards of one project and month in the batch table. */
export const CARD_MONTH_BATCH_LIMIT = 500

// --- Reads -------------------------------------------------------------------

/**
 * The companies and projects the batch screen offers: the cards whose unit
 * is INSIDE now plus the cards whose unit left on or after `sinceDay` (the
 * first day of the oldest month preset, so a unit that left last month still
 * takes its late timesheet), one bounded read; the dialog groups them into
 * companies → projects. 0189: by the card's visit (`exit_at`), the card
 * having no period of its own any more.
 */
export async function fetchCardPlaces(
  sinceDay: string,
  signal?: AbortSignal,
): Promise<CardPlaceRow[]> {
  let request = supabase
    .from('sales_equipment_cards')
    .select(CARD_PLACES_SELECT)
    .or(recentVisitOrClause(saudiDayStart(sinceDay)))
    .order('company_id')
    .order('project_id')
    .order('card_id')
    .limit(CARD_PLACES_LIMIT)
  if (signal) request = request.abortSignal(signal)
  return unwrapRows<CardPlaceRow>(await request)
}

/** The Saudi day of the earliest entry of any card (0189: the card's visit;
 *  it was the card's own start day): where the month pickers stop. */
export async function fetchEarliestCardDay(
  signal?: AbortSignal,
): Promise<string | null> {
  let request = supabase
    .from('sales_equipment_cards')
    .select('entry_at')
    .not('entry_at', 'is', null)
    .order('entry_at', { ascending: true })
    .limit(1)
  if (signal) request = request.abortSignal(signal)
  const rows = unwrapRows<{ entry_at: string }>(await request)
  return rows[0]?.entry_at ? saudiDateKey(rows[0].entry_at) : null
}

/**
 * The batch screen's rows: every card of one company and project covering
 * one month (`sales_card_month_slots`, computed on read, so always filtered
 * by company + project + month), by equipment code.
 */
export async function fetchCardMonthSlots(
  input: { companyId: string; projectId: string; month: string },
  signal?: AbortSignal,
): Promise<CardMonthSlotRow[]> {
  let request = supabase
    .from('sales_card_month_slots')
    .select(CARD_MONTH_SLOTS_SELECT)
    .eq('company_id', input.companyId)
    .eq('project_id', input.projectId)
    .eq('month', monthStartOf(input.month))
    .order('equipment_code', { ascending: true })
    .order('card_id', { ascending: true })
    .limit(CARD_MONTH_BATCH_LIMIT)
  if (signal) request = request.abortSignal(signal)
  return unwrapRows<CardMonthSlotRow>(await request)
}

// --- Writes (the three functions of 0172) ------------------------------------------

/** `record_equipment_card_month`: the upsert of ONE month; returns the
 *  record id. `month` is a month key (YYYY-MM). */
export async function recordEquipmentCardMonth(input: {
  cardId: string
  month: string
  hours: number
  /** 0185: null = no days. */
  days: number | null
  note: string
}): Promise<RpcResult<string>> {
  return asResult<string>(
    await supabase.rpc('record_equipment_card_month', {
      p_card_id: input.cardId,
      p_month: monthStartOf(input.month),
      p_hours: input.hours,
      p_note: input.note.trim() || null,
      p_days: input.days,
    }),
  )
}

/** `record_equipment_card_months`: one project's month in ONE transaction
 *  (a refused item refuses the whole batch with its own token); returns the
 *  number of items recorded. */
export async function recordEquipmentCardMonths(
  month: string,
  items: readonly CardMonthBatchItem[],
): Promise<RpcResult<number>> {
  return asResult<number>(
    await supabase.rpc('record_equipment_card_months', {
      p_month: monthStartOf(month),
      p_items: items.map((item) => ({
        card_id: item.card_id,
        hours: item.hours,
        days: item.days,
        note: item.note?.trim() || null,
      })),
    }),
  )
}

/** `delete_equipment_card_month`. */
export async function deleteEquipmentCardMonth(input: {
  cardId: string
  month: string
}): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('delete_equipment_card_month', {
      p_card_id: input.cardId,
      p_month: monthStartOf(input.month),
    }),
  )
}

// --- Card pricing (the four functions of 0174) ----------------------------------------------

/** `set_equipment_card_client_price`: the client's price of ONE card;
 *  null = no price; since 0185 its unit (null = unchanged). */
export async function setEquipmentCardClientPrice(input: {
  cardId: string
  price: number | null
  rateUnit: SaleRateUnit | null
}): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('set_equipment_card_client_price', {
      p_card_id: input.cardId,
      p_price: input.price,
      p_rate_unit: input.rateUnit,
    }),
  )
}

/** `set_equipment_card_client_prices`: the «اسعار المعدات» save in ONE
 *  transaction (a refused item refuses the whole batch with its own token);
 *  returns the number of items processed. */
export async function setEquipmentCardClientPrices(
  items: readonly CardPriceBatchItem[],
): Promise<RpcResult<number>> {
  return asResult<number>(
    await supabase.rpc('set_equipment_card_client_prices', {
      p_items: items.map((item) => ({
        card_id: item.card_id,
        price: item.price,
        rate_unit: item.rate_unit,
      })),
    }),
  )
}

/** `approve_equipment_card_pricing` (sales.approve): approves the card and,
 *  when it was the PO's last draft card, the supplier PO. */
export async function approveEquipmentCardPricing(
  cardId: string,
): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('approve_equipment_card_pricing', { p_card_id: cardId }),
  )
}

/** `return_equipment_card_pricing` (sales.approve): back to draft, the
 *  approved supplier PO too. */
export async function returnEquipmentCardPricing(input: {
  cardId: string
  note: string
}): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('return_equipment_card_pricing', {
      p_card_id: input.cardId,
      p_note: input.note.trim() || null,
    }),
  )
}
