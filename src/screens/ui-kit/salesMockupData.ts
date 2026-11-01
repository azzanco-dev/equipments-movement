import { vatOf, withVat } from '@/lib/purchasing'
import {
  COMPANIES,
  EQUIPMENT,
  PROJECTS,
  companyById,
  equipmentById,
  projectById,
  type MockEquipment,
  type MockNamed,
} from './purchasingMockupData'

// sales-screens — SAMPLE DATA of the sales phase-1 mockups on /ui-kit (owner
// 2026-11-01: the sales phase starts with «PO العملاء», reviewed as mockups
// first). Everything here is in-memory and invented: no table exists yet, no
// row is read or written. The shapes mirror the intended tables — a client
// PO (one company + one project, the CLIENT's own number as identity, an
// issue date and an optional expiry date, no approval workflow), its lines
// (the unit's equipment card with the SALE price excluding VAT, a price
// unit month / day / hour, the standard hours and an optional contract
// quantity as a ceiling) and an append-only event log. The companies,
// projects and units are the purchasing mockup's, so the two sides of one
// unit can be compared. Arabic copy uses plain alif (no hamza / madda).

export { COMPANIES, EQUIPMENT, PROJECTS, companyById, equipmentById, projectById }
export type { MockEquipment, MockNamed }

export type ClientPoStatus = 'open' | 'closed'

/** The line's price unit on the client side: month, day or hour. */
export type SaleRateUnit = 'month' | 'day' | 'hour'

export const SALE_RATE_UNITS: readonly SaleRateUnit[] = ['month', 'day', 'hour']

/** The suffix after an amount. */
export const SALE_PER_UNIT_LABEL: Readonly<Record<SaleRateUnit, string>> = {
  month: '/ شهر',
  day: '/ يوم',
  hour: '/ ساعة',
}

/** The unit's name on its own («شهري»). */
export const SALE_RATE_UNIT_LABEL: Readonly<Record<SaleRateUnit, string>> = {
  month: 'شهري',
  day: 'يومي',
  hour: 'بالساعة',
}

/** The contract quantity's unit: months or hours (a ceiling for phase 4's
 *  remaining-quantity tracking). */
export type SaleQuantityUnit = 'month' | 'hour'

export interface MockClientPo {
  id: string
  /** The CLIENT's own PO number, as received. */
  po_number: string
  company_id: string
  project_id: string
  issue_date: string
  expiry_date: string | null
  /** The PO's standard hours per month (260 default). */
  standard_hours: number
  status: ClientPoStatus
  closed_at: string | null
  notes: string | null
  created_by_name: string
  created_at: string
  updated_at: string
}

export interface MockClientPoLine {
  id: string
  client_po_id: string
  equipment_id: string
  /** The SALE price excluding VAT. */
  price: number
  rate_unit: SaleRateUnit
  /** The line's standard hours (from the PO unless changed). */
  standard_hours: number
  /** The contract quantity, a ceiling (optional). */
  quantity: number | null
  quantity_unit: SaleQuantityUnit
  /** Placeholder for phase 4: what was consumed so far, in the quantity's
   *  unit. Invented here to draw the remaining bar. */
  consumed: number
  note: string | null
  /** The card behind the line (`equipment_cards`). */
  period_from: string
  period_to: string | null
  updated_at: string
}

export type ClientPoEventType =
  | 'created'
  | 'equipment_added'
  | 'price_changed'
  | 'updated'
  | 'closed'

export const CLIENT_PO_EVENT_LABEL: Readonly<Record<ClientPoEventType, string>> = {
  created: 'انشاء PO العميل',
  equipment_added: 'اضافة معدة',
  price_changed: 'تعديل سعر',
  updated: 'تعديل البيانات',
  closed: 'اقفال PO العميل',
}

export interface MockClientPoEvent {
  id: string
  client_po_id: string
  event_type: ClientPoEventType
  actor_name: string
  created_at: string
  /** A short rendered detail (equipment code, old → new price). */
  detail: string | null
}

export const SALES_ACTOR_NAME = 'نورة القحطاني'

export const CLIENT_POS: MockClientPo[] = [
  {
    id: 'cpo1',
    po_number: 'PO20241200550',
    company_id: 'c2',
    project_id: 'p1',
    issue_date: '2026-10-01',
    expiry_date: '2027-03-31',
    standard_hours: 260,
    status: 'open',
    closed_at: null,
    notes: 'ايجار شهري شامل المشغل، الفوترة اخر كل شهر حسب التايم شيت المعتمد.',
    created_by_name: SALES_ACTOR_NAME,
    created_at: '2026-10-02T09:10:00+03:00',
    updated_at: '2026-10-28T14:20:00+03:00',
  },
  {
    id: 'cpo2',
    po_number: 'PO-ALY-2026-0187',
    company_id: 'c3',
    project_id: 'p3',
    issue_date: '2026-09-15',
    expiry_date: null,
    standard_hours: 260,
    status: 'open',
    closed_at: null,
    notes: null,
    created_by_name: 'خالد العتيبي',
    created_at: '2026-09-16T11:40:00+03:00',
    updated_at: '2026-10-20T08:05:00+03:00',
  },
  {
    id: 'cpo3',
    po_number: 'PO20240900412',
    company_id: 'c2',
    project_id: 'p2',
    issue_date: '2026-06-01',
    expiry_date: '2026-09-30',
    standard_hours: 208,
    status: 'closed',
    closed_at: '2026-09-30T16:00:00+03:00',
    notes: 'انتهت مدة العقد.',
    created_by_name: SALES_ACTOR_NAME,
    created_at: '2026-06-02T10:00:00+03:00',
    updated_at: '2026-09-30T16:00:00+03:00',
  },
]

export const CLIENT_PO_LINES: MockClientPoLine[] = [
  {
    id: 'cl1',
    client_po_id: 'cpo1',
    equipment_id: 'e1',
    price: 18500,
    rate_unit: 'month',
    standard_hours: 260,
    quantity: 6,
    quantity_unit: 'month',
    consumed: 1,
    note: 'شامل المشغل والوقود.',
    period_from: '2026-10-01',
    period_to: null,
    updated_at: '2026-10-28T14:20:00+03:00',
  },
  {
    id: 'cl2',
    client_po_id: 'cpo1',
    equipment_id: 'e2',
    price: 24000,
    rate_unit: 'month',
    standard_hours: 260,
    quantity: 6,
    quantity_unit: 'month',
    consumed: 1,
    note: null,
    period_from: '2026-10-01',
    period_to: null,
    updated_at: '2026-10-05T12:00:00+03:00',
  },
  {
    id: 'cl3',
    client_po_id: 'cpo1',
    equipment_id: 'e5',
    price: 950,
    rate_unit: 'hour',
    standard_hours: 260,
    quantity: 400,
    quantity_unit: 'hour',
    consumed: 112,
    note: 'رافعة عند الطلب، بالساعة.',
    period_from: '2026-10-12',
    period_to: null,
    updated_at: '2026-10-12T09:30:00+03:00',
  },
  {
    id: 'cl4',
    client_po_id: 'cpo2',
    equipment_id: 'e3',
    price: 16000,
    rate_unit: 'month',
    standard_hours: 260,
    quantity: null,
    quantity_unit: 'month',
    consumed: 0,
    note: null,
    period_from: '2026-09-15',
    period_to: null,
    updated_at: '2026-10-20T08:05:00+03:00',
  },
  {
    id: 'cl5',
    client_po_id: 'cpo2',
    equipment_id: 'e4',
    price: 1400,
    rate_unit: 'day',
    standard_hours: 260,
    quantity: 3,
    quantity_unit: 'month',
    consumed: 1,
    note: 'قلاب حسب الحاجة.',
    period_from: '2026-09-20',
    period_to: null,
    updated_at: '2026-09-20T07:45:00+03:00',
  },
  {
    id: 'cl6',
    client_po_id: 'cpo3',
    equipment_id: 'e6',
    price: 21000,
    rate_unit: 'month',
    standard_hours: 208,
    quantity: 4,
    quantity_unit: 'month',
    consumed: 4,
    note: null,
    period_from: '2026-06-01',
    period_to: '2026-09-30',
    updated_at: '2026-09-30T16:00:00+03:00',
  },
]

export const CLIENT_PO_EVENTS: MockClientPoEvent[] = [
  {
    id: 'cev1',
    client_po_id: 'cpo1',
    event_type: 'created',
    actor_name: SALES_ACTOR_NAME,
    created_at: '2026-10-02T09:10:00+03:00',
    detail: 'PO20241200550',
  },
  {
    id: 'cev2',
    client_po_id: 'cpo1',
    event_type: 'equipment_added',
    actor_name: SALES_ACTOR_NAME,
    created_at: '2026-10-02T09:12:00+03:00',
    detail: 'A055 · 18,000.00 / شهر',
  },
  {
    id: 'cev3',
    client_po_id: 'cpo1',
    event_type: 'equipment_added',
    actor_name: SALES_ACTOR_NAME,
    created_at: '2026-10-05T12:00:00+03:00',
    detail: 'F112 · 24,000.00 / شهر',
  },
  {
    id: 'cev4',
    client_po_id: 'cpo1',
    event_type: 'equipment_added',
    actor_name: 'خالد العتيبي',
    created_at: '2026-10-12T09:30:00+03:00',
    detail: 'A118 · 950.00 / ساعة',
  },
  {
    id: 'cev5',
    client_po_id: 'cpo1',
    event_type: 'price_changed',
    actor_name: SALES_ACTOR_NAME,
    created_at: '2026-10-28T14:20:00+03:00',
    detail: 'A055 · 18,000.00 → 18,500.00',
  },
  {
    id: 'cev6',
    client_po_id: 'cpo2',
    event_type: 'created',
    actor_name: 'خالد العتيبي',
    created_at: '2026-09-16T11:40:00+03:00',
    detail: 'PO-ALY-2026-0187',
  },
  {
    id: 'cev7',
    client_po_id: 'cpo2',
    event_type: 'equipment_added',
    actor_name: 'خالد العتيبي',
    created_at: '2026-09-16T11:42:00+03:00',
    detail: 'B207 · 16,000.00 / شهر',
  },
  {
    id: 'cev8',
    client_po_id: 'cpo2',
    event_type: 'equipment_added',
    actor_name: 'خالد العتيبي',
    created_at: '2026-09-20T07:45:00+03:00',
    detail: 'U014 · 1,400.00 / يوم',
  },
  {
    id: 'cev9',
    client_po_id: 'cpo2',
    event_type: 'updated',
    actor_name: SALES_ACTOR_NAME,
    created_at: '2026-10-20T08:05:00+03:00',
    detail: 'تاريخ الانتهاء: —',
  },
  {
    id: 'cev10',
    client_po_id: 'cpo3',
    event_type: 'created',
    actor_name: SALES_ACTOR_NAME,
    created_at: '2026-06-02T10:00:00+03:00',
    detail: 'PO20240900412',
  },
  {
    id: 'cev11',
    client_po_id: 'cpo3',
    event_type: 'equipment_added',
    actor_name: SALES_ACTOR_NAME,
    created_at: '2026-06-02T10:03:00+03:00',
    detail: 'TK031 · 21,000.00 / شهر',
  },
  {
    id: 'cev12',
    client_po_id: 'cpo3',
    event_type: 'closed',
    actor_name: SALES_ACTOR_NAME,
    created_at: '2026-09-30T16:00:00+03:00',
    detail: null,
  },
]

/** The unit of the equipment page's «المبيعات» card. */
export const SALES_CARD_EQUIPMENT_ID = 'e1'

export const clientPoById = (id: string) =>
  CLIENT_POS.find((po) => po.id === id) ?? null

export const linesOfClientPo = (poId: string) =>
  CLIENT_PO_LINES.filter((line) => line.client_po_id === poId)

/**
 * The PO's totals excluding VAT, one per price unit present on its lines,
 * month → day → hour (the purchasing rule: a monthly, a daily and an hourly
 * price are never added together). A PO without lines totals 0 per month.
 */
export function clientPoTotalsByUnit(
  lines: readonly Pick<MockClientPoLine, 'price' | 'rate_unit'>[],
): { unit: SaleRateUnit; total: number }[] {
  const totals = new Map<SaleRateUnit, number>()
  for (const line of lines)
    totals.set(line.rate_unit, (totals.get(line.rate_unit) ?? 0) + line.price)
  const parts = SALE_RATE_UNITS.filter((unit) => totals.has(unit)).map(
    (unit) => ({ unit, total: Math.round((totals.get(unit) ?? 0) * 100) / 100 }),
  )
  return parts.length ? parts : [{ unit: 'month', total: 0 }]
}

/** The three figures of one unit's total: before VAT, the VAT, with VAT. */
export function clientPoTotalFigures(total: number) {
  return { exclVat: total, vat: vatOf(total), inclVat: withVat(total) }
}

/** «6 اشهر» / «400 ساعة»: the contract quantity in words, or null. */
export function quantityLabel(
  quantity: number | null,
  unit: SaleQuantityUnit,
): string | null {
  if (quantity === null) return null
  if (unit === 'hour') return `${quantity} ساعة`
  if (quantity === 1) return 'شهر'
  if (quantity === 2) return 'شهرين'
  if (quantity <= 10) return `${quantity} اشهر`
  return `${quantity} شهرا`
}

/** The remaining share of a contract quantity, 0–1, or null without a ceiling. */
export function remainingShare(line: Pick<MockClientPoLine, 'quantity' | 'consumed'>) {
  if (line.quantity === null || line.quantity <= 0) return null
  return Math.max(0, Math.min(1, (line.quantity - line.consumed) / line.quantity))
}

// --- The tickets of «المعدات في المشاريع» -----------------------------------------

/** One ticket: the unit inside a project with its supplier side and its
 *  client side, each a PO number or nothing. */
export interface MockTicket {
  id: string
  equipment_id: string
  /** The client's own number for the unit on this project («ترقيم الشركة»). */
  contractor_code: string | null
  company_id: string
  project_id: string
  foreman: string
  entry_date: string
  /** The open supplier PO the unit sits on there, else null. */
  supplier_po_number: string | null
  /** The party's open supplier PO the «+» would add to, else a new PO. */
  supplier_party_po_number: string | null
  /** The open client PO line of the unit there, else null. */
  client_po_number: string | null
  /** The open client PO of that company + project the «+» would add to. */
  client_project_po_number: string | null
}

export const TICKETS: MockTicket[] = [
  {
    id: 't1',
    equipment_id: 'e1',
    contractor_code: 'MC-114',
    company_id: 'c2',
    project_id: 'p1',
    foreman: 'سعد الدوسري',
    entry_date: '2026-10-01',
    supplier_po_number: 'SPO260004',
    supplier_party_po_number: null,
    client_po_number: 'PO20241200550',
    client_project_po_number: null,
  },
  {
    id: 't2',
    equipment_id: 'e4',
    contractor_code: 'MC-131',
    company_id: 'c2',
    project_id: 'p1',
    foreman: 'سعد الدوسري',
    entry_date: '2026-10-01',
    supplier_po_number: 'SPO260004',
    supplier_party_po_number: null,
    client_po_number: null,
    client_project_po_number: 'PO20241200550',
  },
  {
    id: 't3',
    equipment_id: 'e3',
    contractor_code: null,
    company_id: 'c3',
    project_id: 'p3',
    foreman: 'ماجد الشهري',
    entry_date: '2026-09-15',
    supplier_po_number: null,
    supplier_party_po_number: 'SPO260002',
    client_po_number: 'PO-ALY-2026-0187',
    client_project_po_number: null,
  },
  {
    id: 't4',
    equipment_id: 'e6',
    contractor_code: 'EM-07',
    company_id: 'c3',
    project_id: 'p3',
    foreman: 'ماجد الشهري',
    entry_date: '2026-10-29',
    supplier_po_number: null,
    supplier_party_po_number: null,
    client_po_number: null,
    client_project_po_number: null,
  },
]

/** The phase-1 decisions the owner took on 2026-11-01, shown above the
 *  screens so the model and the screens are reviewed together. */
export const SALES_DECISIONS: readonly { title: string; detail: string }[] = [
  {
    title: 'PO عميل واحد = شركة واحدة + مشروع واحد',
    detail: 'مراة PO المورد: الشركة هي العميل، والمشروع ثابت على الامر كله.',
  },
  {
    title: 'رقم العميل هو الهوية',
    detail:
      'يسجل رقم PO العميل كما ورد منه (مثل PO20241200550) مع تاريخ الاصدار وتاريخ انتهاء اختياري؛ لا يولد النظام رقما.',
  },
  {
    title: 'البنود على كرت المعدة بسعر البيع بدون ضريبة',
    detail:
      'لكل معدة سعر بدون ضريبة مع وحدته (شهر / يوم / ساعة)، الساعات القياسية (260 من الامر) وكمية تعاقدية اختيارية (اشهر او ساعات) كسقف لمتابعة المتبقي لاحقا. الاجماليات لا تجمع وحدة مع اخرى.',
  },
  {
    title: 'الانضمام بقاعدة المشتريات',
    detail: 'تنضم المعدة وهي داخل تلك الشركة وذلك المشروع الان.',
  },
  {
    title: 'بلا اعتماد حاليا',
    detail: 'وثيقة العميل معتمدة اصلا: الحالة مفتوح / مغلق فقط.',
  },
  {
    title: 'بلا مرفق PDF في المرحلة الاولى',
    detail: 'ارفاق نسخة PO العميل يضاف لاحقا.',
  },
  {
    title: 'الصلاحيات لاحقا',
    detail: 'sales.view و sales.manage ودور مخصص «المبيعات»؛ الشاشات هنا بلا بوابات.',
  },
]
