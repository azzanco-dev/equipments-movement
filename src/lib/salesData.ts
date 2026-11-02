import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import type { TranslationKey } from '@/i18n/translations'
import type { CompanyProjectSource } from '@/lib/companyProject'
import { formatDate } from '@/lib/dateFormat'
import type { SupplierPoRateUnit, SupplierPoStatus } from '@/lib/purchasing'
import {
  type EquipmentCardRef,
  type NamedRef,
  type PartyOpenVisit,
  PURCHASING_UNIT_SELECT,
  type RpcResult,
} from '@/lib/purchasingData'
import {
  clientPoEquipmentPayload,
  type ClientPoCreateLine,
  type ClientPoEventType,
  type ClientPoFormValues,
  type ClientPoStatus,
  type SaleRateUnit,
} from '@/lib/sales'
import { buildSearchFilter } from '@/lib/search'
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
  card_period_from: string
  card_period_to: string | null
  supplier_po_id: string | null
  supplier_po_number: string | null
  supplier_po_status: SupplierPoStatus | null
  supplier_price: number | null
  supplier_rate_unit: SupplierPoRateUnit | null
}

/** Only what the «حسب المعدات» table shows and its row opens. */
export const SALES_PO_UNITS_SELECT =
  'line_id,price,rate_unit,standard_hours,quantity,line_note,line_created_at,updated_at,is_priced,client_po_id,po_number,po_status,issue_date,expiry_date,po_standard_hours,company_id,company_name_ar,company_name_en,project_id,project_name_ar,project_name_en,equipment_card_id,equipment_id,equipment_code,equipment_type,equipment_plate_number,equipment_chassis_number,equipment_ownership_status,equipment_lessor_id,equipment_lessor_name,card_period_from,card_period_to,supplier_po_id,supplier_po_number,supplier_po_status,supplier_price,supplier_rate_unit'

/**
 * One «كرت المعدة» with both sides (`sales_equipment_cards`): the unit, the
 * company and project, the period, the entry it was created from, the
 * client PO line (the open PO's first, else the latest) and the supplier PO
 * line likewise.
 */
export interface SalesEquipmentCardRow {
  card_id: string
  equipment_id: string
  company_id: string
  project_id: string
  period_from: string
  period_to: string | null
  is_open: boolean
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
  supplier_po_status: SupplierPoStatus | null
  supplier_price: number | null
  supplier_rate_unit: SupplierPoRateUnit | null
  has_supplier_po: boolean
}

/** Every column of the view the cards list and the card page show. */
export const EQUIPMENT_CARDS_SELECT =
  'card_id,equipment_id,company_id,project_id,period_from,period_to,is_open,rate_unit,standard_hours,note,entry_log_id,entry_at,created_at,updated_at,equipment_code,equipment_type,equipment_plate_number,equipment_chassis_number,equipment_ownership_status,equipment_lessor_id,equipment_lessor_name,company_name_ar,company_name_en,project_name_ar,project_name_en,client_line_id,client_po_id,client_po_number,client_po_status,client_price,client_rate_unit,client_standard_hours,client_quantity,has_client_po,supplier_line_id,supplier_po_id,supplier_po_number,supplier_po_status,supplier_price,supplier_rate_unit,has_supplier_po'

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

export const CLIENT_PO_LINE_SELECT = `id,client_po_id,equipment_card_id,price,rate_unit,standard_hours,quantity,note,created_at,updated_at,card:equipment_cards(id,equipment_id,period_from,period_to,entry_log_id,equipment:equipment(${PURCHASING_UNIT_SELECT}))`

export const CLIENT_PO_EVENT_SELECT =
  'id,client_po_id,event_type,payload,actor_id,actor_name,created_at,seq'

/** The equipment page shows the unit's lines with their POs, open card first. */
export const EQUIPMENT_SALES_SELECT = `id,client_po_id,equipment_card_id,price,rate_unit,standard_hours,quantity,note,created_at,updated_at,card:equipment_cards!inner(id,equipment_id,period_from,period_to,equipment:equipment(${PURCHASING_UNIT_SELECT})),po:client_pos(${CLIENT_PO_SELECT})`

/** The equipment page shows this many sales lines at most. */
export const EQUIPMENT_SALES_LIMIT = 10

/** The `purchasing_site_units` columns of the client stub (0169, trailing);
 *  selected only for a `sales.view` reader. */
export const SITE_UNITS_CLIENT_SELECT =
  'client_po_id,client_po_number,has_client_po,project_client_po_id,project_client_po_number'

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

/** The card period behind a line: «from – to», or «from – مفتوح». */
export function cardPeriodLabel(
  card: { period_from: string; period_to: string | null },
  t: (key: TranslationKey) => string,
): string {
  const to = card.period_to
    ? formatDate(card.period_to)
    : t('equipmentPurchasingOpenEnd')
  return `${formatDate(card.period_from)} – ${to}`
}

// --- Reads ---------------------------------------------------------------------

/** The open-visit columns the sales pickers read (the purchasing ones). */
const OPEN_VISIT_SEARCH_FIELDS = [
  'equipment_code',
  'equipment_type_search',
  'equipment_plate_number',
  'equipment_plate_digits',
] as const

const OPEN_VISIT_SELECT =
  'entry_id,equipment_id,equipment_code,equipment_type,equipment_plate_number,entry_at,company_id,company_name_ar,company_name_en,project_id,project_name_ar,project_name_en'

/** Every open site visit (`movement_visits`), whatever the unit's owner. */
function openSiteVisits() {
  return supabase
    .from('movement_visits')
    .select(OPEN_VISIT_SELECT)
    .eq('is_open', true)
    .eq('movement_context', 'site')
}

/** A page of open visits; the loop below reads them all. */
export const OPEN_VISITS_PAGE = 500

/**
 * Every unit inside a project right now, grouped by the create dialog into
 * the companies (and under each, the projects) that have units inside, and
 * the units of the chosen project. ALL of them, read page by page by
 * equipment code then entry (the purchasing lesson of 2026-10-31: a single
 * capped request dropped units).
 */
export async function fetchOpenSiteVisits(): Promise<PartyOpenVisit[]> {
  const rows: PartyOpenVisit[] = []
  for (let from = 0; ; from += OPEN_VISITS_PAGE) {
    const page = unwrapRows<PartyOpenVisit>(
      await openSiteVisits()
        .order('equipment_code')
        .order('entry_id')
        .range(from, from + OPEN_VISITS_PAGE - 1),
    )
    rows.push(...page)
    if (page.length < OPEN_VISITS_PAGE) return rows
  }
}

/**
 * «اضافة معدة» on a client PO (the 0169 join rule): only the units INSIDE
 * the PO's company and project right now, first 20 by code; no entry-day
 * rule on the client side. The database re-checks in
 * `add_client_po_equipment`.
 */
export function equipmentAtClientProjectOptionLoader(
  companyId: string,
  projectId: string,
  options: { excludeEquipmentIds?: readonly string[] } = {},
): (query: string) => Promise<AsyncSearchSelectOption[]> {
  const excluded = options.excludeEquipmentIds ?? []
  return async (query) => {
    let request = openSiteVisits()
      .eq('company_id', companyId)
      .eq('project_id', projectId)
      .order('equipment_code')
      .limit(20)
    // Units already on the PO are not offered again.
    if (excluded.length)
      request = request.not('equipment_id', 'in', `(${excluded.join(',')})`)
    const searchFilter = buildSearchFilter(OPEN_VISIT_SEARCH_FIELDS, query)
    if (searchFilter) request = request.or(searchFilter)
    return unwrapRows<PartyOpenVisit>(await request).map((visit) => ({
      value: visit.equipment_id,
      label: visit.equipment_code,
      description: [visit.equipment_type, visit.equipment_plate_number]
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
