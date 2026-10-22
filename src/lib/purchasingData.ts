import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import type { TranslationKey } from '@/i18n/translations'
import type { CompanyProjectSource } from '@/lib/companyProject'
import type { PostgresLikeError } from '@/lib/formValidation'
import type {
  SupplierPoCreateLine,
  SupplierPoEventType,
  SupplierPoFormValues,
  SupplierPoOwnerClass,
  SupplierPoStatus,
} from '@/lib/purchasing'
import {
  SUPPLIER_PO_CLASS_OPTION_PREFIX,
  SUPPLIER_PO_OWNER_CLASSES,
  SUPPLIER_PO_OWNER_CLASS_LABEL_KEYS,
  isSupplierPoOwnerClass,
  supplierPoEquipmentPayload,
  supplierPoSupplierLabel,
} from '@/lib/purchasing'
import { localizedName } from '@/lib/localizedName'
import type { Language } from '@/i18n/translations'
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
  /** 0138: the party when it is an owner class, not a lessor row. */
  owner_class: string | null
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
  /** 0138: the computed column `unpriced_count(supplier_pos)`. */
  unpriced_count?: number | null
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
  /** NULL since 0138 while the price is still to be entered. */
  price: number | null
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
  /** 0141: insertion order within one created_at. */
  seq?: number | null
}

/** One line of the equipment page's purchasing card: the line with its PO. */
export interface EquipmentPurchasingRow extends SupplierPoLineRow {
  po: SupplierPoRow | null
}

// --- Selects -----------------------------------------------------------------

const NAMED = 'id,name_ar,name_en'

export const SUPPLIER_PO_SELECT = `id,po_number,lessor_id,owner_class,is_internal,company_id,project_id,start_date,status,closed_at,notes,created_by,created_at,unpriced_count,lessor:lessors(id,name),company:companies(${NAMED}),project:projects(${NAMED})`

/** The list adds the line count (one embedded count per row). */
export const SUPPLIER_PO_LIST_SELECT = `${SUPPLIER_PO_SELECT},supplier_po_equipment(count)`

export const PURCHASING_UNIT_SELECT =
  'id,code,type,plate_number,chassis_number,ownership_status,lessor:lessors(id,name,is_internal)'

export const SUPPLIER_PO_LINE_SELECT = `id,supplier_po_id,equipment_card_id,price,note,created_at,updated_at,card:equipment_cards(id,equipment_id,period_from,period_to,entry_log_id,equipment:equipment(${PURCHASING_UNIT_SELECT}))`

export const SUPPLIER_PO_EVENT_SELECT =
  'id,supplier_po_id,event_type,payload,actor_id,created_at,seq'

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
  if (unit.ownership_status === 'alazani') return t('supplierPoOwnerAlazani')
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

/** Sum of the PRICED lines, excluding VAT, and how many lines have no price. */
export function supplierPoTotal(
  lines: readonly { price: number | null }[],
): { total: number; unpriced: number } {
  let total = 0
  let unpriced = 0
  for (const line of lines) {
    if (line.price === null || line.price === undefined) unpriced += 1
    else total += Number(line.price)
  }
  return { total, unpriced }
}

/** The party of a PO as the loaders filter by it. */
export type SupplierPoParty =
  | { lessor_id: string; owner_class: null }
  | { lessor_id: null; owner_class: SupplierPoOwnerClass }

export function supplierPoParty(
  po: Pick<SupplierPoRow, 'lessor_id' | 'owner_class'>,
): SupplierPoParty | null {
  if (isSupplierPoOwnerClass(po.owner_class))
    return { lessor_id: null, owner_class: po.owner_class }
  if (po.lessor_id) return { lessor_id: po.lessor_id, owner_class: null }
  return null
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

/** The open-visit columns the purchasing pickers read. */
const OPEN_VISIT_SEARCH_FIELDS = [
  'equipment_code',
  'equipment_type_search',
  'equipment_plate_number',
  'equipment_plate_digits',
] as const

const OPEN_VISIT_SELECT =
  'entry_id,equipment_id,equipment_code,equipment_type,equipment_plate_number,entry_at,company_id,company_name_ar,company_name_en,project_id,project_name_ar,project_name_en'

/** One open site visit of a party's unit (`movement_visits`). */
export interface PartyOpenVisit {
  entry_id: string
  equipment_id: string
  equipment_code: string
  equipment_type: string | null
  equipment_plate_number: string | null
  entry_at: string
  company_id: string
  company_name_ar: string | null
  company_name_en: string | null
  project_id: string
  project_name_ar: string | null
  project_name_en: string | null
}

/** The open site visits of the party's units: the party's lessor, or the
 *  party's owner class, on `movement_visits` (RLS of the movements). */
function partyOpenVisits(party: SupplierPoParty) {
  const base = supabase
    .from('movement_visits')
    .select(OPEN_VISIT_SELECT)
    .eq('is_open', true)
    .eq('movement_context', 'site')
  return party.owner_class
    ? base.eq('equipment_ownership_status', party.owner_class)
    : base.eq('equipment_lessor_id', party.lessor_id)
}

/**
 * The party picker of «امر شراء جديد» (0138): the four fixed owner classes
 * first (matched by their label), then the lessors by server-side search.
 */
export function partyOptionLoader(
  loadLessors: (query: string) => Promise<AsyncSearchSelectOption[]>,
  t: (key: TranslationKey) => string,
): (query: string) => Promise<AsyncSearchSelectOption[]> {
  const classes: AsyncSearchSelectOption[] = SUPPLIER_PO_OWNER_CLASSES.map(
    (owner) => ({
      value: `${SUPPLIER_PO_CLASS_OPTION_PREFIX}${owner}`,
      label: t(SUPPLIER_PO_OWNER_CLASS_LABEL_KEYS[owner]),
    }),
  )
  return async (query) => {
    const text = query.trim().toLowerCase()
    const matching = text
      ? classes.filter((option) => option.label.toLowerCase().includes(text))
      : classes
    const lessors = await loadLessors(query)
    return [...matching, ...lessors.slice(0, 20 - matching.length)]
  }
}

/** The party's open visits, grouped: the companies (and under each, the
 *  projects) where the party has units right now. One bounded request; a
 *  party has a handful of open visits. */
export async function fetchPartyOpenVisits(
  party: SupplierPoParty,
): Promise<PartyOpenVisit[]> {
  const rows = unwrapRows<PartyOpenVisit>(
    await partyOpenVisits(party).order('equipment_code').limit(200),
  )
  return rows
}

/** Distinct companies of some open visits, as picker options. */
export function visitCompanyOptions(
  visits: readonly PartyOpenVisit[],
  lang: Language,
): AsyncSearchSelectOption[] {
  const seen = new Map<string, AsyncSearchSelectOption>()
  for (const visit of visits)
    if (!seen.has(visit.company_id))
      seen.set(visit.company_id, {
        value: visit.company_id,
        label: localizedName(lang, visit.company_name_ar, visit.company_name_en),
      })
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, lang))
}

/** Distinct projects of one company among some open visits. */
export function visitProjectOptions(
  visits: readonly PartyOpenVisit[],
  companyId: string,
  lang: Language,
): AsyncSearchSelectOption[] {
  const seen = new Map<string, AsyncSearchSelectOption>()
  for (const visit of visits)
    if (visit.company_id === companyId && !seen.has(visit.project_id))
      seen.set(visit.project_id, {
        value: visit.project_id,
        label: localizedName(lang, visit.project_name_ar, visit.project_name_en),
      })
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, lang))
}

/** A static option list as a picker loader (substring match on the label). */
export function staticOptionLoader(
  options: readonly AsyncSearchSelectOption[],
): (query: string) => Promise<AsyncSearchSelectOption[]> {
  return async (query) => {
    const text = query.trim().toLowerCase()
    return (
      text
        ? options.filter((option) => option.label.toLowerCase().includes(text))
        : [...options]
    ).slice(0, 20)
  }
}

/**
 * «اضافة معدة» (owner rules 2026-10-19/20, migrations 0137/0138): only the
 * party's units INSIDE the PO's company and project right now, first 20 by
 * code. The database re-checks both rules in `add_supplier_po_equipment`.
 */
export function equipmentAtProjectOptionLoader(
  party: SupplierPoParty,
  companyId: string,
  projectId: string,
  options: { excludeEquipmentIds?: readonly string[] } = {},
): (query: string) => Promise<AsyncSearchSelectOption[]> {
  const excluded = options.excludeEquipmentIds ?? []
  return async (query) => {
    let request = partyOpenVisits(party)
      .eq('company_id', companyId)
      .eq('project_id', projectId)
      .order('equipment_code')
      .limit(20)
    // Units already on the PO are not offered again (owner 2026-10-22).
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

/** `create_supplier_po` (0138): the party (a lessor OR an owner class), the
 *  PO and its equipment in one call; returns the new PO id. */
export async function createSupplierPo(
  values: SupplierPoFormValues,
  lines: readonly SupplierPoCreateLine[] = [],
): Promise<RpcResult<string>> {
  return asResult<string>(
    await supabase.rpc('create_supplier_po', {
      p_lessor_id: values.lessor_id || null,
      p_owner_class: values.owner_class || null,
      p_company_id: values.company_id,
      p_project_id: values.project_id,
      p_start_date: values.start_date,
      p_notes: values.notes.trim() || null,
      p_equipment: supplierPoEquipmentPayload(lines),
    }),
  )
}

/** `add_supplier_po_equipment`: returns the new line id. */
export async function addSupplierPoEquipment(input: {
  poId: string
  equipmentId: string
  /** Optional since 0138 (null = «تحتاج سعر»). */
  price: number | null
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
