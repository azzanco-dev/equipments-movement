import { vatOf, withVat } from '@/lib/purchasing'
import {
  COMPANIES,
  EQUIPMENT as PURCHASING_EQUIPMENT,
  PROJECTS,
  companyById,
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

export { COMPANIES, PROJECTS, companyById, projectById }
export type { MockEquipment, MockNamed }

/** Two units of the sales mockups only (phase-2 samples: a client line
 *  without a price and a daily client line); the purchasing units stay. */
export const SALES_EXTRA_EQUIPMENT: MockEquipment[] = [
  {
    id: 'e7',
    code: 'F204',
    type: 'EXCAVATOR 336',
    plate_number: 'ق ك ل 5512',
    chassis_number: null,
    internal: false,
    ownership: 'third_party_f',
    lessor_name: null,
  },
  {
    id: 'e8',
    code: 'U022',
    type: 'WATER TANKER 32000 L',
    plate_number: 'م ن ه 7731',
    chassis_number: null,
    internal: false,
    ownership: 'external_supplier',
    lessor_name: 'مؤسسة النخبة لتاجير المعدات',
  },
]

export const EQUIPMENT: MockEquipment[] = [
  ...PURCHASING_EQUIPMENT,
  ...SALES_EXTRA_EQUIPMENT,
]

export const equipmentById = (id: string) =>
  EQUIPMENT.find((unit) => unit.id === id) ?? null

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

const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'ابريل',
  'مايو',
  'يونيو',
  'يوليو',
  'اغسطس',
  'سبتمبر',
  'اكتوبر',
  'نوفمبر',
  'ديسمبر',
]

/** «اكتوبر 2026» from a `YYYY-MM` key. */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-')
  const index = Number(month) - 1
  return `${ARABIC_MONTHS[index] ?? month} ${year}`
}

/** «اكتوبر (10)» from a `YYYY-MM` key: the month presets' look in Arabic. */
export function monthShortLabel(key: string): string {
  const month = key.slice(5, 7)
  const index = Number(month) - 1
  return `${ARABIC_MONTHS[index] ?? month} (${index + 1})`
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

/** The phase-2 decisions («كروت التشغيل», owner 2026-11-03), shown above the
 *  phase-2 screens so the rules and the screens are reviewed together. */
export const SALES_PHASE2_DECISIONS: readonly { title: string; detail: string }[] = [
  {
    title: 'نفس الاكسل',
    detail:
      'الساعات دائما كما سجلت. مستحق العميل = السعر الشهري × الساعات ÷ الساعات القياسية للسطر (260)؛ السطر بالساعة = السعر × الساعات؛ السطر اليومي بلا قاعدة بعد («—»).',
  },
  {
    title: 'مستحق المورد بنفس الساعات',
    detail:
      'نفس ساعات الشهر على السعر الشهري لسطر المورد ÷ الساعات القياسية لسطر العميل. معدة العزاني بلا مستحق مورد، والهامش = مستحق العميل كاملا.',
  },
  {
    title: 'بلا اعتماد',
    detail: 'سجل الشهر يحفظ ويعدل بحرية مثل PO العميل، ومن عدله يظهر في سجل احداث الكرت.',
  },
  {
    title: 'شاشة ادخال جماعي',
    detail:
      'تايم شيت العميل الشهري يغطي مشروعا كاملا: شركة + مشروع + شهر = جدول واحد وحفظ واحد.',
  },
  {
    title: 'مرفق التايم شيت لاحقا',
    detail: 'الحالة هنا هي حالة التسجيل: «مسجل» او «بانتظار» (شهر منقضي لكرت مفتوح بلا ساعات).',
  },
]

// --- «كرت المعدة»: the spine both sides attach to ---------------------------------

export type CardStatus = 'open' | 'ended'

/**
 * «كرت التشغيل», phase 2 (owner decisions 2026-11-03): one RECORDED month of
 * a card — the hours of a Saudi month from the client's monthly timesheet,
 * entered by sales. Hours are always what is recorded, never computed; a
 * record is edited freely (the card's event log says who), and there is no
 * approval. A month without a record is derived, never stored (see
 * `cardMonthRows`).
 */
export interface MockCardMonth {
  /** Saudi month key, `YYYY-MM`. */
  month: string
  /** Hours worked in the month, as the timesheet says. */
  hours: number
  note: string | null
  recorded_by_name: string
  recorded_at: string
}

/** The Saudi day the mockups count from, so the sample months and the month
 *  presets («Sep (9) · Oct (10) · Nov (11)») stay aligned whenever the
 *  owner reviews the page. The real screens use `saudiDateKey()`. */
export const SAMPLE_TODAY = '2026-11-03'

/**
 * «كرت المعدة» (`equipment_cards`): one unit in one company + project over a
 * period, with its two sides — the supplier PO line (purchase price) and the
 * client PO line (sale price, standard hours, optional contract quantity).
 * An Al-Azani unit has the client side only (`owned`). The movement facts
 * come from the entry the card stores (`entry_log_id`).
 */
export interface MockCard {
  id: string
  equipment_id: string
  company_id: string
  project_id: string
  period_from: string
  period_to: string | null
  status: CardStatus
  /** The card's shared fields (client side): rate unit and standard hours. */
  rate_unit: SaleRateUnit
  standard_hours: number
  // The movement behind the card.
  entry_id: string
  entry_date: string
  exit_date: string | null
  foreman: string
  driver: string
  // The client side (the client PO line), or none yet.
  client_po_number: string | null
  sale_price: number | null
  quantity: number | null
  quantity_unit: SaleQuantityUnit
  consumed: number
  // The supplier side (the supplier PO line), or none; an owned unit never has one.
  owned: boolean
  supplier_po_number: string | null
  supplier_name: string | null
  purchase_price: number | null
  purchase_rate_unit: SaleRateUnit
  updated_at: string
  /** The RECORDED months (phase 2 sample). Months without a record are
   *  derived from the card's period (`cardMonthRows`). */
  months: MockCardMonth[]
}

const RECORDER_NAME = 'خالد العتيبي'

/** The rented page sample (F112): August and September full, September
 *  corrected from 240 to 260 (see its events), October 248; November runs. */
const MONTHS_RENTED: MockCardMonth[] = [
  {
    month: '2026-08',
    hours: 260,
    note: null,
    recorded_by_name: RECORDER_NAME,
    recorded_at: '2026-09-02T09:20:00+03:00',
  },
  {
    month: '2026-09',
    hours: 260,
    note: 'تصحيح بعد مراجعة التايم شيت مع الموقع.',
    recorded_by_name: SALES_ACTOR_NAME,
    recorded_at: '2026-10-06T11:15:00+03:00',
  },
  {
    month: '2026-10',
    hours: 248,
    note: null,
    recorded_by_name: RECORDER_NAME,
    recorded_at: '2026-11-02T08:40:00+03:00',
  },
]

/** The owned page sample (A055): September and October recorded. */
const MONTHS_OWNED: MockCardMonth[] = [
  {
    month: '2026-09',
    hours: 236,
    note: null,
    recorded_by_name: RECORDER_NAME,
    recorded_at: '2026-10-03T10:30:00+03:00',
  },
  {
    month: '2026-10',
    hours: 262,
    note: null,
    recorded_by_name: RECORDER_NAME,
    recorded_at: '2026-11-02T08:52:00+03:00',
  },
]

/** The daily page sample (U022): September recorded; the amounts stay «—»
 *  until the daily rule exists. */
const MONTHS_DAILY: MockCardMonth[] = [
  {
    month: '2026-09',
    hours: 240,
    note: null,
    recorded_by_name: RECORDER_NAME,
    recorded_at: '2026-10-03T10:41:00+03:00',
  },
]

/** The third-party B unit on the Dammam bridge: October recorded. */
const MONTHS_B207: MockCardMonth[] = [
  {
    month: '2026-10',
    hours: 255,
    note: null,
    recorded_by_name: SALES_ACTOR_NAME,
    recorded_at: '2026-11-01T13:05:00+03:00',
  },
]

/** The ended card (June – September, 208 standard hours): every month in. */
const MONTHS_ENDED: MockCardMonth[] = [
  {
    month: '2026-06',
    hours: 208,
    note: null,
    recorded_by_name: RECORDER_NAME,
    recorded_at: '2026-07-02T09:00:00+03:00',
  },
  {
    month: '2026-07',
    hours: 214,
    note: null,
    recorded_by_name: RECORDER_NAME,
    recorded_at: '2026-08-02T09:00:00+03:00',
  },
  {
    month: '2026-08',
    hours: 196,
    note: 'توقف اسبوع بسبب الصيانة.',
    recorded_by_name: RECORDER_NAME,
    recorded_at: '2026-09-02T09:00:00+03:00',
  },
  {
    month: '2026-09',
    hours: 208,
    note: null,
    recorded_by_name: RECORDER_NAME,
    recorded_at: '2026-10-02T09:00:00+03:00',
  },
]

export const CARDS: MockCard[] = [
  {
    // The page's RENTED sample: both sides.
    id: 'card1',
    equipment_id: 'e2',
    company_id: 'c2',
    project_id: 'p1',
    period_from: '2026-07-15',
    period_to: null,
    status: 'open',
    rate_unit: 'month',
    standard_hours: 260,
    entry_id: 'mv-9012',
    entry_date: '2026-07-15',
    exit_date: null,
    foreman: 'سعد الدوسري',
    driver: 'محمد عبدالله الزهراني',
    client_po_number: 'PO20241200550',
    sale_price: 24000,
    quantity: 6,
    quantity_unit: 'month',
    consumed: 3,
    owned: false,
    supplier_po_number: 'SPO260011',
    supplier_name: 'شركة الخليج للمعدات الثقيلة',
    purchase_price: 17000,
    purchase_rate_unit: 'month',
    updated_at: '2026-10-28T14:20:00+03:00',
    months: MONTHS_RENTED,
  },
  {
    // The page's OWNED sample: the client side only.
    id: 'card2',
    equipment_id: 'e1',
    company_id: 'c2',
    project_id: 'p1',
    period_from: '2026-09-01',
    period_to: null,
    status: 'open',
    rate_unit: 'month',
    standard_hours: 260,
    entry_id: 'mv-9105',
    entry_date: '2026-09-01',
    exit_date: null,
    foreman: 'سعد الدوسري',
    driver: 'عبدالرحمن سالم الغامدي',
    client_po_number: 'PO20241200550',
    sale_price: 18500,
    quantity: 6,
    quantity_unit: 'month',
    consumed: 2,
    owned: true,
    supplier_po_number: null,
    supplier_name: null,
    purchase_price: null,
    purchase_rate_unit: 'month',
    updated_at: '2026-10-05T12:00:00+03:00',
    months: MONTHS_OWNED,
  },
  {
    id: 'card3',
    equipment_id: 'e5',
    company_id: 'c2',
    project_id: 'p1',
    period_from: '2026-10-12',
    period_to: null,
    status: 'open',
    rate_unit: 'hour',
    standard_hours: 260,
    entry_id: 'mv-9230',
    entry_date: '2026-10-12',
    exit_date: null,
    foreman: 'سعد الدوسري',
    driver: 'فهد ناصر العمري',
    client_po_number: 'PO20241200550',
    sale_price: 950,
    quantity: 400,
    quantity_unit: 'hour',
    consumed: 112,
    owned: true,
    supplier_po_number: null,
    supplier_name: null,
    purchase_price: null,
    purchase_rate_unit: 'month',
    updated_at: '2026-10-12T09:30:00+03:00',
    months: [],
  },
  {
    id: 'card4',
    equipment_id: 'e4',
    company_id: 'c2',
    project_id: 'p1',
    period_from: '2026-10-01',
    period_to: null,
    status: 'open',
    rate_unit: 'day',
    standard_hours: 260,
    entry_id: 'mv-9201',
    entry_date: '2026-10-01',
    exit_date: null,
    foreman: 'سعد الدوسري',
    driver: 'علي حسن القرني',
    client_po_number: null,
    sale_price: null,
    quantity: null,
    quantity_unit: 'month',
    consumed: 0,
    owned: false,
    supplier_po_number: 'SPO260004',
    supplier_name: 'مؤسسة النخبة لتاجير المعدات',
    purchase_price: 950,
    purchase_rate_unit: 'day',
    updated_at: '2026-10-01T08:30:00+03:00',
    months: [],
  },
  {
    id: 'card5',
    equipment_id: 'e3',
    company_id: 'c3',
    project_id: 'p3',
    period_from: '2026-09-15',
    period_to: null,
    status: 'open',
    rate_unit: 'month',
    standard_hours: 260,
    entry_id: 'mv-9150',
    entry_date: '2026-09-15',
    exit_date: null,
    foreman: 'ماجد الشهري',
    driver: 'سالم محمد الحارثي',
    client_po_number: 'PO-ALY-2026-0187',
    sale_price: 16000,
    quantity: null,
    quantity_unit: 'month',
    consumed: 0,
    owned: false,
    supplier_po_number: null,
    supplier_name: 'طرف ثالث B',
    purchase_price: null,
    purchase_rate_unit: 'month',
    updated_at: '2026-10-20T08:05:00+03:00',
    months: MONTHS_B207,
  },
  {
    id: 'card6',
    equipment_id: 'e6',
    company_id: 'c3',
    project_id: 'p3',
    period_from: '2026-10-29',
    period_to: null,
    status: 'open',
    rate_unit: 'month',
    standard_hours: 260,
    entry_id: 'mv-9310',
    entry_date: '2026-10-29',
    exit_date: null,
    foreman: 'ماجد الشهري',
    driver: 'ياسر احمد الشمراني',
    client_po_number: null,
    sale_price: null,
    quantity: null,
    quantity_unit: 'month',
    consumed: 0,
    owned: false,
    supplier_po_number: null,
    supplier_name: 'تكوين',
    purchase_price: null,
    purchase_rate_unit: 'month',
    updated_at: '2026-10-29T07:10:00+03:00',
    months: [],
  },
  {
    id: 'card7',
    equipment_id: 'e4',
    company_id: 'c3',
    project_id: 'p3',
    period_from: '2026-09-20',
    period_to: null,
    status: 'open',
    rate_unit: 'day',
    standard_hours: 260,
    entry_id: 'mv-9170',
    entry_date: '2026-09-20',
    exit_date: null,
    foreman: 'ماجد الشهري',
    driver: 'علي حسن القرني',
    client_po_number: 'PO-ALY-2026-0187',
    sale_price: 1400,
    quantity: 3,
    quantity_unit: 'month',
    consumed: 1,
    owned: false,
    supplier_po_number: 'SPO260002',
    supplier_name: 'مؤسسة النخبة لتاجير المعدات',
    purchase_price: 950,
    purchase_rate_unit: 'day',
    updated_at: '2026-09-20T07:45:00+03:00',
    months: [],
  },
  {
    id: 'card8',
    equipment_id: 'e1',
    company_id: 'c1',
    project_id: 'p2',
    period_from: '2026-10-20',
    period_to: null,
    status: 'open',
    rate_unit: 'month',
    standard_hours: 260,
    entry_id: 'mv-9280',
    entry_date: '2026-10-20',
    exit_date: null,
    foreman: 'بدر سعيد العسيري',
    driver: 'عبدالرحمن سالم الغامدي',
    client_po_number: null,
    sale_price: null,
    quantity: null,
    quantity_unit: 'month',
    consumed: 0,
    owned: true,
    supplier_po_number: null,
    supplier_name: null,
    purchase_price: null,
    purchase_rate_unit: 'month',
    updated_at: '2026-10-20T10:00:00+03:00',
    months: [],
  },
  {
    // The ENDED card: the unit left the project, both sides closed.
    id: 'card9',
    equipment_id: 'e6',
    company_id: 'c2',
    project_id: 'p2',
    period_from: '2026-06-01',
    period_to: '2026-09-30',
    status: 'ended',
    rate_unit: 'month',
    standard_hours: 208,
    entry_id: 'mv-8720',
    entry_date: '2026-06-01',
    exit_date: '2026-09-30',
    foreman: 'بدر سعيد العسيري',
    driver: 'ياسر احمد الشمراني',
    client_po_number: 'PO20240900412',
    sale_price: 21000,
    quantity: 4,
    quantity_unit: 'month',
    consumed: 4,
    owned: false,
    supplier_po_number: 'SPO260001',
    supplier_name: 'تكوين',
    purchase_price: 15500,
    purchase_rate_unit: 'month',
    updated_at: '2026-09-30T16:00:00+03:00',
    months: MONTHS_ENDED,
  },
  {
    // Phase 2: a DAILY client line (and a daily supplier line) — the
    // amounts stay «—» until the daily rule exists; hours are recorded.
    id: 'card10',
    equipment_id: 'e8',
    company_id: 'c2',
    project_id: 'p1',
    period_from: '2026-09-05',
    period_to: null,
    status: 'open',
    rate_unit: 'day',
    standard_hours: 260,
    entry_id: 'mv-9120',
    entry_date: '2026-09-05',
    exit_date: null,
    foreman: 'سعد الدوسري',
    driver: 'حسين علي اليامي',
    client_po_number: 'PO20241200550',
    sale_price: 1400,
    quantity: 3,
    quantity_unit: 'month',
    consumed: 1,
    owned: false,
    supplier_po_number: 'SPO260004',
    supplier_name: 'مؤسسة النخبة لتاجير المعدات',
    purchase_price: 950,
    purchase_rate_unit: 'day',
    updated_at: '2026-10-03T10:41:00+03:00',
    months: MONTHS_DAILY,
  },
  {
    // Phase 2: a client line WITHOUT a price yet («تحتاج سعر») on a priced
    // supplier line.
    id: 'card11',
    equipment_id: 'e7',
    company_id: 'c2',
    project_id: 'p1',
    period_from: '2026-10-03',
    period_to: null,
    status: 'open',
    rate_unit: 'month',
    standard_hours: 260,
    entry_id: 'mv-9208',
    entry_date: '2026-10-03',
    exit_date: null,
    foreman: 'سعد الدوسري',
    driver: 'عمر خالد البقمي',
    client_po_number: 'PO20241200550',
    sale_price: null,
    quantity: null,
    quantity_unit: 'month',
    consumed: 0,
    owned: false,
    supplier_po_number: 'SPO260012',
    supplier_name: 'طرف ثالث F',
    purchase_price: 19000,
    purchase_rate_unit: 'month',
    updated_at: '2026-10-03T09:10:00+03:00',
    months: [],
  },
]

/** The three cards of the page's toggle: rented (both sides), owned, and a
 *  daily client line (phase 2: its amounts are «—» for now). */
export const CARD_PAGE_SAMPLES: Readonly<Record<'rented' | 'owned' | 'daily', string>> = {
  rented: 'card1',
  owned: 'card2',
  daily: 'card10',
}

export const cardById = (id: string) => CARDS.find((card) => card.id === id) ?? null

export type CardEventType =
  | 'created'
  | 'supplier_line_added'
  | 'client_line_added'
  | 'hours_recorded'
  | 'hours_updated'
  | 'hours_deleted'
  | 'ended'

export const CARD_EVENT_LABEL: Readonly<Record<CardEventType, string>> = {
  created: 'انشاء الكرت مع دخول المعدة',
  supplier_line_added: 'ربط سطر PO المورد',
  client_line_added: 'ربط سطر PO العميل',
  hours_recorded: 'تسجيل ساعات',
  hours_updated: 'تعديل ساعات',
  hours_deleted: 'حذف ساعات',
  ended: 'انهاء الكرت مع خروج المعدة',
}

export interface MockCardEvent {
  id: string
  card_id: string
  event_type: CardEventType
  actor_name: string
  created_at: string
  detail: string | null
}

export const CARD_EVENTS: MockCardEvent[] = [
  {
    id: 'cae1',
    card_id: 'card1',
    event_type: 'created',
    actor_name: 'النظام',
    created_at: '2026-07-15T07:40:00+03:00',
    detail: 'F112 · مشروع طريق الملك فهد',
  },
  {
    id: 'cae2',
    card_id: 'card1',
    event_type: 'supplier_line_added',
    actor_name: 'سارة المطيري',
    created_at: '2026-07-15T09:05:00+03:00',
    detail: 'SPO260011 · 17,000.00 / شهر',
  },
  {
    id: 'cae3',
    card_id: 'card1',
    event_type: 'client_line_added',
    actor_name: SALES_ACTOR_NAME,
    created_at: '2026-10-05T12:00:00+03:00',
    detail: 'PO20241200550 · 24,000.00 / شهر',
  },
  {
    id: 'cae4',
    card_id: 'card1',
    event_type: 'hours_recorded',
    actor_name: RECORDER_NAME,
    created_at: '2026-09-02T09:20:00+03:00',
    detail: hoursRecordedDetail('2026-08', 260),
  },
  {
    id: 'cae4b',
    card_id: 'card1',
    event_type: 'hours_recorded',
    actor_name: RECORDER_NAME,
    created_at: '2026-10-02T09:05:00+03:00',
    detail: hoursRecordedDetail('2026-09', 240),
  },
  {
    id: 'cae4c',
    card_id: 'card1',
    event_type: 'hours_updated',
    actor_name: SALES_ACTOR_NAME,
    created_at: '2026-10-06T11:15:00+03:00',
    detail: hoursUpdatedDetail('2026-09', 240, 260),
  },
  {
    id: 'cae4d',
    card_id: 'card1',
    event_type: 'hours_recorded',
    actor_name: RECORDER_NAME,
    created_at: '2026-11-02T08:40:00+03:00',
    detail: hoursRecordedDetail('2026-10', 248),
  },
  {
    id: 'cae5',
    card_id: 'card2',
    event_type: 'created',
    actor_name: 'النظام',
    created_at: '2026-09-01T06:55:00+03:00',
    detail: 'A055 · مشروع طريق الملك فهد',
  },
  {
    id: 'cae6',
    card_id: 'card2',
    event_type: 'client_line_added',
    actor_name: SALES_ACTOR_NAME,
    created_at: '2026-10-02T09:12:00+03:00',
    detail: 'PO20241200550 · 18,500.00 / شهر',
  },
  {
    id: 'cae7',
    card_id: 'card2',
    event_type: 'hours_recorded',
    actor_name: RECORDER_NAME,
    created_at: '2026-10-03T10:30:00+03:00',
    detail: hoursRecordedDetail('2026-09', 236),
  },
  {
    id: 'cae8',
    card_id: 'card2',
    event_type: 'hours_recorded',
    actor_name: RECORDER_NAME,
    created_at: '2026-11-02T08:52:00+03:00',
    detail: hoursRecordedDetail('2026-10', 262),
  },
  {
    id: 'cae9',
    card_id: 'card10',
    event_type: 'created',
    actor_name: 'النظام',
    created_at: '2026-09-05T07:30:00+03:00',
    detail: 'U022 · مشروع طريق الملك فهد',
  },
  {
    id: 'cae10',
    card_id: 'card10',
    event_type: 'supplier_line_added',
    actor_name: 'سارة المطيري',
    created_at: '2026-09-05T09:00:00+03:00',
    detail: 'SPO260004 · 950.00 / يوم',
  },
  {
    id: 'cae11',
    card_id: 'card10',
    event_type: 'client_line_added',
    actor_name: SALES_ACTOR_NAME,
    created_at: '2026-10-02T09:15:00+03:00',
    detail: 'PO20241200550 · 1,400.00 / يوم',
  },
  {
    id: 'cae12',
    card_id: 'card10',
    event_type: 'hours_recorded',
    actor_name: RECORDER_NAME,
    created_at: '2026-10-03T10:41:00+03:00',
    detail: hoursRecordedDetail('2026-09', 240),
  },
]

// --- Phase 2: the months of a card and the monthly amounts -------------------------

/**
 * Why one side of a month has no amount. `no_line`: the card has no PO line
 * on that side; `unpriced`: the line has no price yet («تحتاج سعر»);
 * `daily`: a daily line, whose rule comes later («—» with a hint);
 * `owned`: the supplier side of an Al-Azani unit; `no_hours`: the month is
 * not recorded yet.
 */
export type DueBlocker = 'no_line' | 'unpriced' | 'daily' | 'owned' | 'no_hours'

export interface MonthDue {
  value: number | null
  blocker: DueBlocker | null
}

const roundMoney = (value: number) => Math.round(value * 100) / 100

/**
 * The month's due of one side (owner 2026-11-03, «نفس الاكسل»): a monthly
 * price × hours ÷ the CLIENT line's standard hours; an hourly price × hours;
 * a daily price has no rule yet. Hours are always what is recorded.
 */
export function monthDue(
  price: number | null,
  unit: SaleRateUnit,
  hours: number | null,
  standardHours: number,
  hasLine = true,
): MonthDue {
  if (!hasLine) return { value: null, blocker: 'no_line' }
  if (price === null) return { value: null, blocker: 'unpriced' }
  if (unit === 'day') return { value: null, blocker: 'daily' }
  if (hours === null) return { value: null, blocker: 'no_hours' }
  if (unit === 'hour') return { value: roundMoney(price * hours), blocker: null }
  if (standardHours <= 0) return { value: null, blocker: 'unpriced' }
  return { value: roundMoney((price * hours) / standardHours), blocker: null }
}

export interface CardMonthFigures {
  client: MonthDue
  supplier: MonthDue
  margin: MonthDue
}

/**
 * The month's figures of a card for the given hours: the client due, the
 * supplier due (the SAME hours on the supplier line's price ÷ the client
 * line's standard hours; none for an owned unit) and the margin (client −
 * supplier, or the client due in full for an owned unit).
 */
export function cardMonthFigures(
  card: MockCard,
  hours: number | null,
): CardMonthFigures {
  const client = monthDue(
    card.sale_price,
    card.rate_unit,
    hours,
    card.standard_hours,
    card.client_po_number !== null,
  )
  const supplier: MonthDue = card.owned
    ? { value: null, blocker: 'owned' }
    : monthDue(
        card.purchase_price,
        card.purchase_rate_unit,
        hours,
        card.standard_hours,
        card.supplier_po_number !== null,
      )
  let margin: MonthDue
  if (client.value === null) margin = { value: null, blocker: client.blocker }
  else if (card.owned) margin = { value: client.value, blocker: null }
  else if (supplier.value === null) margin = { value: null, blocker: supplier.blocker }
  else margin = { value: roundMoney(client.value - supplier.value), blocker: null }
  return { client, supplier, margin }
}

/** The state of a card's month: recorded, awaited (an elapsed month without
 *  a record) or the running month without a record. */
export type CardMonthState = 'recorded' | 'pending' | 'running'

export const CARD_MONTH_STATE_LABEL: Readonly<Record<CardMonthState, string>> = {
  recorded: 'مسجل',
  pending: 'بانتظار',
  running: 'جاري',
}

/** One month of a card as the screens list it: the record when there is one. */
export interface CardMonthRow {
  month: string
  state: CardMonthState
  record: MockCardMonth | null
}

const monthKeyOf = (dateKey: string) => dateKey.slice(0, 7)

/** The `YYYY-MM` key `offset` months after `key` (negative goes back). */
export function shiftMonth(key: string, offset: number): string {
  const [year, month] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return date.toISOString().slice(0, 7)
}

/** The month keys of a card from its first month to its last (the end of its
 *  period, else the month of `today`), oldest first. */
export function cardMonthKeys(
  card: Pick<MockCard, 'period_from' | 'period_to'>,
  today: string = SAMPLE_TODAY,
): string[] {
  const first = monthKeyOf(card.period_from)
  const last = monthKeyOf(card.period_to ?? today)
  const keys: string[] = []
  for (let key = first; key <= last && keys.length < 120; key = shiftMonth(key, 1))
    keys.push(key)
  return keys
}

/** Whether the card is open at some moment of the month. */
export function cardCoversMonth(
  card: Pick<MockCard, 'period_from' | 'period_to'>,
  month: string,
): boolean {
  const from = monthKeyOf(card.period_from)
  const to = card.period_to ? monthKeyOf(card.period_to) : null
  return from <= month && (to === null || to >= month)
}

/** The rows of a card's months, oldest first: the record of each month, or
 *  its derived state («بانتظار» for an elapsed month, «جاري» for the running
 *  one). `records` replaces the card's own list when the screen holds the
 *  edited copy. */
export function cardMonthRows(
  card: MockCard,
  records: readonly MockCardMonth[] = card.months,
  today: string = SAMPLE_TODAY,
): CardMonthRow[] {
  const thisMonth = monthKeyOf(today)
  return cardMonthKeys(card, today).map((month) => {
    const record = records.find((item) => item.month === month) ?? null
    const state: CardMonthState = record
      ? 'recorded'
      : month === thisMonth && card.period_to === null
        ? 'running'
        : 'pending'
    return { month, state, record }
  })
}

/** The latest recorded month of a card, or null. */
export function latestRecordedMonth(
  records: readonly MockCardMonth[],
): MockCardMonth | null {
  return (
    [...records].sort((a, b) => b.month.localeCompare(a.month))[0] ?? null
  )
}

/** The hours in words: «248 ساعة». */
export function hoursLabel(hours: number): string {
  return `${hours} ساعة`
}

/** «3 شهور» for the save button of the batch screen. */
export function monthsCountLabel(count: number): string {
  if (count === 1) return 'شهر'
  if (count === 2) return 'شهرين'
  if (count <= 10) return `${count} شهور`
  return `${count} شهرا`
}

/** The detail of a «تسجيل ساعات» event: «اكتوبر (10): 248 ساعة». */
export function hoursRecordedDetail(month: string, hours: number): string {
  return `${monthShortLabel(month)}: ${hoursLabel(hours)}`
}

/** The detail of a «تعديل ساعات» event. The arrow reads right to left: the
 *  old hours on the start side, the arrow pointing to the new ones, as the
 *  activity page writes a change («نشطة ← مباعة»). */
export function hoursUpdatedDetail(month: string, from: number, to: number): string {
  return `${monthShortLabel(month)}: ${from} ← ${to}`
}
