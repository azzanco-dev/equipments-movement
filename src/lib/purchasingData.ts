import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import type { TranslationKey } from '@/i18n/translations'
import type { CompanyProjectSource } from '@/lib/companyProject'
import type { PostgresLikeError } from '@/lib/formValidation'
import type {
  SupplierPoEventType,
  SupplierPoFormValues,
  SupplierPoStatus,
} from '@/lib/purchasing'
import { supplierPoSupplierLabel } from '@/lib/purchasing'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import { unwrapRows } from '@/lib/supabaseResult'
import type { OwnershipStatus } from '@/lib/types'

/**
 * purchasing-screens — the DATA side of the real purchasing screens
 * (migration 0136): the rows the screens select, the four write functions
 * they call, and the small derivations on top of them. Every read goes
 * through PostgREST with the signed-in user's token (RLS: `purchasing.view`),
 * every write through the SECURITY DEFINER functions of 0136 (RLS has no
 * insert / update policy on the purchasing tables), so the database stays
 * authoritative. The pure labels and the token → field mapping live in
 * `src/lib/purchasing.ts`.
 */

// --- Rows --------------------------------------------------------------------

export interface NamedRef {
  id: string
  name_ar: string | null
  name_en: string | null
}

export interface LessorRef {
  id: string
  name: string | null
  is_internal?: boolean
}

/** `supplier_pos` with its embeds and the line count. */
export interface SupplierPoRow {
  id: string
  po_number: string
  lessor_id: string | null
  is_internal: boolean
  company_id: string
  project_id: string
  start_date: string
  status: SupplierPoStatus
  closed_at: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  lessor: LessorRef | null
  company: NamedRef | null
  project: NamedRef | null
  /** PostgREST count embed: `supplier_po_equipment(count)`. */
  supplier_po_equipment?: { count: number }[] | null
}

/** The unit behind a line, as the add dialog and the page need it. */
export interface PurchasingUnit {
  id: string
  code: string
  type: string
  plate_number: string | null
  chassis_number: string | null
  ownership_status: OwnershipStatus
  lessor: LessorRef | null
}

/** The card behind a line (`equipment_cards`), with its unit embedded. */
export interface EquipmentCardRef {
  id: string
  equipment_id: string
  period_from: string
  period_to: string | null
  /** 0137: the site entry that brought the unit (set by the database). */
  entry_log_id?: string | null
  equipment: PurchasingUnit | null
}

/** `supplier_po_equipment` joined through its card. */
export interface SupplierPoLineRow {
  id: string
  supplier_po_id: string
  equipment_card_id: string
  price: number
  note: string | null
  created_at: string
  updated_at: string
  card: EquipmentCardRef | null
}

export interface SupplierPoEventRow {
  id: string
  supplier_po_id: string
  event_type: SupplierPoEventType
  payload: Record<string, unknown> | null
  actor_id: string | null
  created_at: string
}

/** One line of the equipment page's purchasing card: the line with its PO. */
export interface EquipmentPurchasingRow extends SupplierPoLineRow {
  po: SupplierPoRow | null
}

// --- Selects -----------------------------------------------------------------

const NAMED = 'id,name_ar,name_en'

export const SUPPLIER_PO_SELECT = `id,po_number,lessor_id,is_internal,company_id,project_id,start_date,status,closed_at,notes,created_by,created_at,lessor:lessors(id,name),company:companies(${NAMED}),project:projects(${NAMED})`

/** The list adds the line count (one embedded count per row). */
export const SUPPLIER_PO_LIST_SELECT = `${SUPPLIER_PO_SELECT},supplier_po_equipment(count)`

export const PURCHASING_UNIT_SELECT =
  'id,code,type,plate_number,chassis_number,ownership_status,lessor:lessors(id,name,is_internal)'

export const SUPPLIER_PO_LINE_SELECT = `id,supplier_po_id,equipment_card_id,price,note,created_at,updated_at,card:equipment_cards(id,equipment_id,period_from,period_to,entry_log_id,equipment:equipment(${PURCHASING_UNIT_SELECT}))`

export const SUPPLIER_PO_EVENT_SELECT =
  'id,supplier_po_id,event_type,payload,actor_id,created_at'

/** The equipment page shows the unit's lines with their POs, open card first. */
export const EQUIPMENT_PURCHASING_SELECT = `id,supplier_po_id,equipment_card_id,price,note,created_at,updated_at,card:equipment_cards!inner(id,equipment_id,period_from,period_to,equipment:equipment(${PURCHASING_UNIT_SELECT})),po:supplier_pos(${SUPPLIER_PO_SELECT})`

/** The equipment page shows this many purchasing lines at most. */
export const EQUIPMENT_PURCHASING_LIMIT = 10

// --- Derivations ---------------------------------------------------------------

/** The line count of a list row (0 when the embed is missing). */
export function supplierPoLineCount(row: SupplierPoRow): number {
  return row.supplier_po_equipment?.[0]?.count ?? 0
}

/** `is_internal_equipment(id)` as the client can see it: an Al-Azani unit, or
 *  a unit of a lessor marked `is_internal`. Such a unit costs 0 on a PO. */
export function isInternalUnit(
  unit: Pick<PurchasingUnit, 'ownership_status' | 'lessor'> | null | undefined,
): boolean {
  if (!unit) return false
  return unit.ownership_status === 'alazani' || Boolean(unit.lessor?.is_internal)
}

/** The supplier NAME of a line (owner 2026-10-19): the unit's own supplier
 *  when it has one, else the PO's; «العزاني» for an Al-Azani unit. */
export function lineSupplierName(
  unit: PurchasingUnit | null | undefined,
  po: Pick<SupplierPoRow, 'is_internal' | 'lessor'>,
  t: (key: TranslationKey) => string,
): string {
  if (!unit) return '—'
  if (unit.ownership_status === 'alazani') return t('supplierPoInternalSupplier')
  return unit.lessor?.name?.trim() || supplierPoSupplierLabel(po, t)
}

/** The PO row as the shared company / project cell reads it. */
export function supplierPoCompanyProject(
  po: Pick<SupplierPoRow, 'company_id' | 'project_id' | 'company' | 'project'>,
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

/** Sum of the line prices, excluding VAT. */
export function supplierPoTotal(lines: readonly { price: number }[]): number {
  return lines.reduce((sum, line) => sum + Number(line.price), 0)
}

/** The days from the PO start date to today (Saudi calendar days), >= 0. */
export function daysSinceDateKey(dateKey: string, todayKey: string): number {
  const start = Date.parse(`${dateKey}T00:00:00+03:00`)
  const today = Date.parse(`${todayKey}T00:00:00+03:00`)
  if (Number.isNaN(start) || Number.isNaN(today)) return 0
  return Math.max(0, Math.round((today - start) / 86_400_000))
}

/** A short rendered detail of an event, from its payload (the code and the
 *  price, or the old → new price), or null when the payload has none. */
export function supplierPoEventDetail(
  event: Pick<SupplierPoEventRow, 'event_type' | 'payload'>,
  codeOf: (equipmentId: string) => string | null,
  formatPrice: (value: unknown) => string,
): string | null {
  const payload = event.payload ?? {}
  const code =
    typeof payload.equipment_id === 'string'
      ? codeOf(payload.equipment_id)
      : null
  switch (event.event_type) {
    case 'created':
      return typeof payload.po_number === 'string' ? payload.po_number : null
    case 'equipment_added':
      return [code, formatPrice(payload.price)].filter(Boolean).join(' · ')
    case 'price_changed':
      return [
        code,
        `${formatPrice(payload.old_price)} → ${formatPrice(payload.new_price)}`,
      ]
        .filter(Boolean)
        .join(' · ')
    default:
      return null
  }
}

// --- Reads ---------------------------------------------------------------------

/** The open-visit columns the add dialog's search reads. */
const OPEN_VISIT_SEARCH_FIELDS = [
  'equipment_code',
  'equipment_type_search',
  'equipment_plate_number',
  'equipment_plate_digits',
] as const

interface OpenVisitRow {
  entry_id: string
  equipment_id: string
  equipment_code: string
  equipment_type: string | null
  equipment_plate_number: string | null
  entry_at: string
}

/**
 * Server-side searched options for «اضافة معدة» (owner rule 2026-10-19,
 * migration 0137): only the units INSIDE the PO's company and project right
 * now, i.e. the open site visits of that company and project
 * (`movement_visits`, RLS of the movements), first 20 by code. The database
 * re-checks the same rule in `add_supplier_po_equipment`.
 */
export function equipmentAtProjectOptionLoader(
  companyId: string,
  projectId: string,
): (query: string) => Promise<AsyncSearchSelectOption[]> {
  return async (query) => {
    let request = supabase
      .from('movement_visits')
      .select(
        'entry_id,equipment_id,equipment_code,equipment_type,equipment_plate_number,entry_at',
      )
      .eq('is_open', true)
      .eq('movement_context', 'site')
      .eq('company_id', companyId)
      .eq('project_id', projectId)
      .order('equipment_code')
      .limit(20)
    const searchFilter = buildSearchFilter(OPEN_VISIT_SEARCH_FIELDS, query)
    if (searchFilter) request = request.or(searchFilter)
    return unwrapRows<OpenVisitRow>(await request).map((visit) => ({
      value: visit.equipment_id,
      label: visit.equipment_code,
      description: [visit.equipment_type, visit.equipment_plate_number]
        .filter(Boolean)
        .join(' · '),
    }))
  }
}

/** The unit behind a picked option, with its owner and supplier, so the
 *  dialog can lock the price of an internal one at 0. */
export async function fetchPurchasingUnit(
  equipmentId: string,
): Promise<PurchasingUnit | null> {
  const { data, error } = await supabase
    .from('equipment')
    .select(PURCHASING_UNIT_SELECT)
    .eq('id', equipmentId)
    .maybeSingle()
  if (error) return null
  return (data as unknown as PurchasingUnit | null) ?? null
}

// --- Writes (the four functions of 0136) --------------------------------------------

export type RpcResult<T> =
  | { data: T; error: null }
  | { data: null; error: PostgresLikeError }

function asResult<T>(result: {
  data: unknown
  error: { code?: string; message: string; details?: string; hint?: string } | null
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

/** `create_supplier_po`: returns the new PO id. An empty supplier = an
 *  internal PO (Al-Azani units). */
export async function createSupplierPo(
  values: SupplierPoFormValues,
): Promise<RpcResult<string>> {
  return asResult<string>(
    await supabase.rpc('create_supplier_po', {
      p_lessor_id: values.lessor_id || null,
      p_company_id: values.company_id,
      p_project_id: values.project_id,
      p_start_date: values.start_date,
      p_notes: values.notes.trim() || null,
    }),
  )
}

/** `add_supplier_po_equipment`: returns the new line id. */
export async function addSupplierPoEquipment(input: {
  poId: string
  equipmentId: string
  price: number
  note: string
}): Promise<RpcResult<string>> {
  return asResult<string>(
    await supabase.rpc('add_supplier_po_equipment', {
      p_po_id: input.poId,
      p_equipment_id: input.equipmentId,
      p_price: input.price,
      p_note: input.note.trim() || null,
    }),
  )
}

/** `update_supplier_po_equipment_price`. */
export async function updateSupplierPoEquipmentPrice(input: {
  lineId: string
  price: number
}): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('update_supplier_po_equipment_price', {
      p_line_id: input.lineId,
      p_price: input.price,
    }),
  )
}

/** `close_supplier_po`. */
export async function closeSupplierPo(poId: string): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('close_supplier_po', { p_po_id: poId }),
  )
}
