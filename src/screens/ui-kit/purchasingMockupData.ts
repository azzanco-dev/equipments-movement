import type { SupplierPoEventType, SupplierPoStatus } from '@/lib/purchasing'

// purchasing-screens — SAMPLE DATA of the purchasing mockups on /ui-kit
// (owner decision 2026-10-19: the three screens are reviewed as mockups
// first). Everything here is in-memory and invented: no row exists in the
// database, nothing is read or written. The shapes mirror the 0136 tables
// (supplier_pos, supplier_po_equipment joined through equipment_cards,
// supplier_po_events) plus the embedded names the real screens will select.
// Arabic copy follows the project rule of plain alif (no hamza / madda).

export interface MockLessor {
  id: string
  name: string
  is_internal: boolean
}

export interface MockNamed {
  id: string
  name_ar: string
  name_en: string
}

export interface MockEquipment {
  id: string
  code: string
  type: string
  plate_number: string | null
  chassis_number: string | null
  /** `is_internal_equipment(id)`: Al-Azani, or a lessor marked is_internal. */
  internal: boolean
  /** `equipment.ownership_status`. */
  ownership:
    | 'alazani'
    | 'takween'
    | 'third_party_f'
    | 'third_party_partnership_b'
    | 'external_supplier'
  /** The unit's own supplier (`equipment.lessor`), external supplier only. */
  lessor_name: string | null
}

export interface MockPo {
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
  created_by_name: string
  created_at: string
}

export interface MockLine {
  id: string
  supplier_po_id: string
  equipment_id: string
  price: number
  note: string | null
  /** The card behind the line (`equipment_cards`). */
  period_from: string
  period_to: string | null
}

export interface MockEvent {
  id: string
  supplier_po_id: string
  event_type: SupplierPoEventType
  actor_name: string
  created_at: string
  /** A short rendered detail (equipment code, old → new price). */
  detail: string | null
}

export const ACTOR_NAME = 'سارة المطيري'

export const LESSORS: MockLessor[] = [
  { id: 'l1', name: 'مؤسسة النخبة لتاجير المعدات', is_internal: false },
  { id: 'l2', name: 'شركة الخليج للمعدات الثقيلة', is_internal: false },
  { id: 'l3', name: 'مؤسسة الرواد للنقليات', is_internal: false },
  { id: 'l4', name: 'شركة تكوين المعدات', is_internal: true },
]

export const COMPANIES: MockNamed[] = [
  {
    id: 'c1',
    name_ar: 'شركة عبدالله العزاني للمقاولات',
    name_en: 'Abdullah Al-Azani Contracting',
  },
  { id: 'c2', name_ar: 'شركة البناء الحديث', name_en: 'Modern Construction' },
  { id: 'c3', name_ar: 'مجموعة الاعمار', name_en: 'Al-Emar Group' },
]

export const PROJECTS: MockNamed[] = [
  { id: 'p1', name_ar: 'مشروع طريق الملك فهد', name_en: 'King Fahd Road' },
  { id: 'p2', name_ar: 'مشروع حي الياسمين', name_en: 'Al-Yasmin District' },
  { id: 'p3', name_ar: 'مشروع جسر الدمام', name_en: 'Dammam Bridge' },
]

export const EQUIPMENT: MockEquipment[] = [
  {
    id: 'e1',
    code: 'A055',
    type: 'BOOM TRUCK 10 TON',
    plate_number: 'ا ب ج 8631',
    chassis_number: null,
    internal: true,
    ownership: 'alazani',
    lessor_name: null,
  },
  {
    id: 'e2',
    code: 'F112',
    type: 'EXCAVATOR 320',
    plate_number: null,
    chassis_number: 'CAT0320DXK1234567',
    internal: false,
    ownership: 'third_party_f',
    lessor_name: null,
  },
  {
    id: 'e3',
    code: 'B207',
    type: 'WHEEL LOADER 950',
    plate_number: 'د ه و 4410',
    chassis_number: null,
    internal: false,
    ownership: 'third_party_partnership_b',
    lessor_name: null,
  },
  {
    id: 'e4',
    code: 'U014',
    type: 'DUMP TRUCK 18 M3',
    plate_number: 'ر س ص 2278',
    chassis_number: null,
    internal: false,
    ownership: 'external_supplier',
    lessor_name: 'مؤسسة النخبة لتاجير المعدات',
  },
  {
    id: 'e5',
    code: 'A118',
    type: 'MOBILE CRANE 50 TON',
    plate_number: 'ط ظ ع 9034',
    chassis_number: null,
    internal: true,
    ownership: 'alazani',
    lessor_name: null,
  },
  {
    id: 'e6',
    code: 'TK031',
    type: 'GRADER 140',
    plate_number: null,
    chassis_number: 'TKG140H0987654',
    internal: true,
    ownership: 'takween',
    lessor_name: null,
  },
]

export const POS: MockPo[] = [
  {
    id: 'po1',
    po_number: 'SPO260004',
    lessor_id: 'l1',
    is_internal: false,
    company_id: 'c2',
    project_id: 'p1',
    start_date: '2026-10-01',
    status: 'open',
    closed_at: null,
    notes: 'ايجار شهري، التسليم في موقع المشروع.',
    created_by_name: ACTOR_NAME,
    created_at: '2026-10-01T08:30:00+03:00',
  },
  {
    id: 'po2',
    po_number: 'SPO260003',
    lessor_id: null,
    is_internal: true,
    company_id: 'c1',
    project_id: 'p2',
    start_date: '2026-09-15',
    status: 'open',
    closed_at: null,
    notes: null,
    created_by_name: 'خالد العتيبي',
    created_at: '2026-09-15T10:05:00+03:00',
  },
  {
    id: 'po3',
    po_number: 'SPO260002',
    lessor_id: 'l2',
    is_internal: false,
    company_id: 'c3',
    project_id: 'p3',
    start_date: '2026-08-01',
    status: 'closed',
    closed_at: '2026-09-30T16:20:00+03:00',
    notes: 'انتهى العمل بالمشروع.',
    created_by_name: ACTOR_NAME,
    created_at: '2026-08-01T09:00:00+03:00',
  },
  {
    id: 'po4',
    po_number: 'SPO260001',
    lessor_id: 'l3',
    is_internal: false,
    company_id: 'c2',
    project_id: 'p2',
    start_date: '2026-07-10',
    status: 'closed',
    closed_at: '2026-08-31T12:00:00+03:00',
    notes: null,
    created_by_name: 'خالد العتيبي',
    created_at: '2026-07-10T11:40:00+03:00',
  },
]

export const LINES: MockLine[] = [
  {
    id: 'ln1',
    supplier_po_id: 'po1',
    equipment_id: 'e2',
    price: 18500,
    note: null,
    period_from: '2026-10-01',
    period_to: null,
  },
  {
    id: 'ln2',
    supplier_po_id: 'po1',
    equipment_id: 'e3',
    price: 12750.5,
    note: 'شامل السائق',
    period_from: '2026-10-01',
    period_to: null,
  },
  {
    id: 'ln3',
    supplier_po_id: 'po1',
    equipment_id: 'e1',
    price: 0,
    note: null,
    period_from: '2026-10-01',
    period_to: null,
  },
  {
    id: 'ln4',
    supplier_po_id: 'po2',
    equipment_id: 'e5',
    price: 0,
    note: null,
    period_from: '2026-09-15',
    period_to: null,
  },
  {
    id: 'ln5',
    supplier_po_id: 'po3',
    equipment_id: 'e4',
    price: 9800,
    note: null,
    period_from: '2026-08-01',
    period_to: '2026-09-30',
  },
  {
    id: 'ln6',
    supplier_po_id: 'po3',
    equipment_id: 'e2',
    price: 17000,
    note: 'سعر الصيف',
    period_from: '2026-08-01',
    period_to: '2026-09-30',
  },
]

export const EVENTS: MockEvent[] = [
  {
    id: 'ev1',
    supplier_po_id: 'po1',
    event_type: 'created',
    actor_name: ACTOR_NAME,
    created_at: '2026-10-01T08:30:00+03:00',
    detail: 'SPO260004',
  },
  {
    id: 'ev2',
    supplier_po_id: 'po1',
    event_type: 'equipment_added',
    actor_name: ACTOR_NAME,
    created_at: '2026-10-01T08:34:00+03:00',
    detail: 'F112 · 18,500.00',
  },
  {
    id: 'ev3',
    supplier_po_id: 'po1',
    event_type: 'equipment_added',
    actor_name: ACTOR_NAME,
    created_at: '2026-10-01T08:36:00+03:00',
    detail: 'B207 · 12,000.00',
  },
  {
    id: 'ev4',
    supplier_po_id: 'po1',
    event_type: 'price_changed',
    actor_name: 'خالد العتيبي',
    created_at: '2026-10-05T13:10:00+03:00',
    detail: 'B207 · 12,000.00 → 12,750.50',
  },
  {
    id: 'ev5',
    supplier_po_id: 'po1',
    event_type: 'equipment_added',
    actor_name: ACTOR_NAME,
    created_at: '2026-10-07T09:02:00+03:00',
    detail: 'A055 · 0.00',
  },
  {
    id: 'ev6',
    supplier_po_id: 'po3',
    event_type: 'created',
    actor_name: ACTOR_NAME,
    created_at: '2026-08-01T09:00:00+03:00',
    detail: 'SPO260002',
  },
  {
    id: 'ev7',
    supplier_po_id: 'po3',
    event_type: 'equipment_added',
    actor_name: ACTOR_NAME,
    created_at: '2026-08-01T09:05:00+03:00',
    detail: 'U014 · 9,800.00',
  },
  {
    id: 'ev8',
    supplier_po_id: 'po3',
    event_type: 'equipment_added',
    actor_name: ACTOR_NAME,
    created_at: '2026-08-01T09:07:00+03:00',
    detail: 'F112 · 17,000.00',
  },
  {
    id: 'ev9',
    supplier_po_id: 'po3',
    event_type: 'closed',
    actor_name: 'خالد العتيبي',
    created_at: '2026-09-30T16:20:00+03:00',
    detail: null,
  },
  {
    id: 'ev10',
    supplier_po_id: 'po2',
    event_type: 'created',
    actor_name: 'خالد العتيبي',
    created_at: '2026-09-15T10:05:00+03:00',
    detail: 'SPO260003',
  },
  {
    id: 'ev11',
    supplier_po_id: 'po2',
    event_type: 'equipment_added',
    actor_name: 'خالد العتيبي',
    created_at: '2026-09-15T10:09:00+03:00',
    detail: 'A118 · 0.00',
  },
]

/** The unit whose «المشتريات» card the third mockup shows (F112: one open
 *  line on SPO260004 and one closed card on SPO260002). */
export const CARD_EQUIPMENT_ID = 'e2'

export const lessorById = (id: string | null) =>
  LESSORS.find((lessor) => lessor.id === id) ?? null
export const companyById = (id: string) =>
  COMPANIES.find((company) => company.id === id) ?? null
export const projectById = (id: string) =>
  PROJECTS.find((project) => project.id === id) ?? null
export const equipmentById = (id: string) =>
  EQUIPMENT.find((unit) => unit.id === id) ?? null
