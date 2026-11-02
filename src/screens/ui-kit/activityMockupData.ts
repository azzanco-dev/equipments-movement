// Sample data of the activity page mockup (owner 2026-11-02: «خلنا نسوي سجل
// تعديلات المعدات، يكون ضمن النشاط، وصفحة النشاط يبغالها اعادة بناء برضه»).
// One unified list over the two audit logs — movement_audit_logs (0069) and
// equipment_audit_logs (0168) — as the rebuilt page would read it through one
// view. Nothing here touches Supabase; every row is written by hand and every
// time is fixed, so the page renders the same in every review.

export type ActivityKind = 'movement' | 'equipment'
export type ActivityAction = 'create' | 'update' | 'delete'

/** One changed field with its readable label and the values before / after.
 *  `null` is «—» (the field was empty before, or is empty now). */
export interface ActivityChange {
  key: string
  label: string
  before: string | null
  after: string | null
}

export interface ActivityRow {
  id: number
  /** ISO time of the audit row (UTC). */
  at: string
  actor: string | null
  kind: ActivityKind
  action: ActivityAction
  equipmentCode: string
  equipmentType: string
  /** The page the record cell opens: the movement, or the unit. */
  href: string
  /** Movement rows: the movement's type and context, for the identity line. */
  movement?: {
    type: 'entry' | 'exit'
    context: 'site' | 'workshop'
  }
  changes: ActivityChange[]
}

/** The review's «now»: Monday 2026-11-02 10:30 Saudi time (07:30 UTC), so
 *  «منذ …» reads the same on every visit. */
export const ACTIVITY_NOW = Date.parse('2026-11-02T07:30:00Z')

/** The unit of the «سجل التعديلات» card (the A028 case of 2026-11-01). */
export const CARD_UNIT = {
  id: 'eq-a028',
  code: 'A028',
  type: 'حفارة',
}

export const ACTORS = [
  'مبارك بكرمان',
  'سالم العمري',
  'ماجد الحربي',
  'عبدالله الدوسري',
  'فهد القحطاني',
] as const

/** The equipment fields a reader can filter by («الحقل»), in the order the
 *  filter lists them. The key is the column of public.equipment. */
export const EQUIPMENT_FIELDS: { key: string; label: string }[] = [
  { key: 'status', label: 'الحالة' },
  { key: 'ownership_status', label: 'المالك' },
  { key: 'lessor_id', label: 'المورد' },
  { key: 'code', label: 'رقم المعدة' },
  { key: 'type', label: 'النوع' },
  { key: 'plate_number', label: 'اللوحة' },
  { key: 'chassis_number', label: 'رقم الشاصي' },
  { key: 'is_active', label: 'مفعلة' },
  { key: 'tracker_unit_id', label: 'وحدة افاقي' },
  { key: 'project_id', label: 'المشروع' },
]

const ALAZANI = 'شركة عبدالله العزاني للمقاولات'
const TAKWEEN = 'شركة تكوين المعدات للمقاولات'

export const ACTIVITY_ROWS: ActivityRow[] = [
  {
    id: 1,
    at: '2026-11-02T07:12:00Z',
    actor: 'سالم العمري',
    kind: 'movement',
    action: 'create',
    equipmentCode: 'A291',
    equipmentType: 'لودر',
    href: '/movements/m-1',
    movement: { type: 'entry', context: 'site' },
    changes: [
      {
        key: 'company_id',
        label: 'الشركة',
        before: null,
        after: 'شركة البناء المتحدة',
      },
      {
        key: 'project_id',
        label: 'المشروع',
        before: null,
        after: 'مجمع الواحة',
      },
      { key: 'driver_id', label: 'السائق', before: null, after: 'محمد علي' },
      {
        key: 'recorded_at',
        label: 'وقت الحركة',
        before: null,
        after: '2026-11-02T06:55:00Z',
      },
    ],
  },
  {
    id: 2,
    at: '2026-11-02T06:40:00Z',
    actor: 'مبارك بكرمان',
    kind: 'equipment',
    action: 'update',
    equipmentCode: 'A028',
    equipmentType: 'حفارة',
    href: '/equipment/eq-a028',
    changes: [
      { key: 'status', label: 'الحالة', before: 'نشطة', after: 'مباعة' },
      { key: 'is_active', label: 'مفعلة', before: 'نعم', after: 'لا' },
    ],
  },
  {
    id: 3,
    at: '2026-11-02T05:05:00Z',
    actor: 'ماجد الحربي',
    kind: 'movement',
    action: 'update',
    equipmentCode: 'TK114',
    equipmentType: 'شيول',
    href: '/movements/m-3',
    movement: { type: 'entry', context: 'site' },
    changes: [
      {
        key: 'driver_change',
        label: 'تغيير السائق',
        before: 'خالد سعيد',
        after: 'ناصر عوض',
      },
    ],
  },
  {
    id: 4,
    at: '2026-11-01T13:20:00Z',
    actor: 'مبارك بكرمان',
    kind: 'equipment',
    action: 'update',
    equipmentCode: 'F207',
    equipmentType: 'بوكلين',
    href: '/equipment/eq-f207',
    changes: [
      {
        key: 'ownership_status',
        label: 'المالك',
        before: TAKWEEN,
        after: ALAZANI,
      },
      { key: 'code', label: 'رقم المعدة', before: 'TK207', after: 'F207' },
      {
        key: 'plate_number',
        label: 'اللوحة',
        before: '4471 KDA',
        after: '4471 KDB',
      },
      {
        key: 'chassis_number',
        label: 'رقم الشاصي',
        before: null,
        after: 'JHB00412',
      },
      {
        key: 'tracker_unit_id',
        label: 'وحدة افاقي',
        before: null,
        after: '(F207) 8631 URA',
      },
    ],
  },
  {
    id: 5,
    at: '2026-11-01T11:02:00Z',
    actor: 'عبدالله الدوسري',
    kind: 'movement',
    action: 'create',
    equipmentCode: 'A055',
    equipmentType: 'قلاب',
    href: '/movements/m-5',
    movement: { type: 'entry', context: 'workshop' },
    changes: [
      {
        key: 'workshop_purpose',
        label: 'غرض الدخول',
        before: null,
        after: 'صيانة',
      },
      {
        key: 'recorded_at',
        label: 'وقت الحركة',
        before: null,
        after: '2026-11-01T10:48:00Z',
      },
    ],
  },
  {
    id: 6,
    at: '2026-11-01T08:30:00Z',
    actor: 'مبارك بكرمان',
    kind: 'equipment',
    action: 'create',
    equipmentCode: 'U118',
    equipmentType: 'مولد كهرباء',
    href: '/equipment/eq-u118',
    changes: [
      { key: 'type', label: 'النوع', before: null, after: 'مولد كهرباء' },
      {
        key: 'ownership_status',
        label: 'المالك',
        before: null,
        after: 'مالك اخر',
      },
      {
        key: 'lessor_id',
        label: 'المورد',
        before: null,
        after: 'مؤسسة الرواد للمعدات',
      },
    ],
  },
  {
    id: 7,
    at: '2026-10-31T14:45:00Z',
    actor: 'فهد القحطاني',
    kind: 'movement',
    action: 'create',
    equipmentCode: 'B032',
    equipmentType: 'رافعة',
    href: '/movements/m-7',
    movement: { type: 'exit', context: 'site' },
    changes: [
      {
        key: 'exit_purpose',
        label: 'غرض الخروج',
        before: null,
        after: 'انتهاء عمل',
      },
      {
        key: 'recorded_at',
        label: 'وقت الحركة',
        before: null,
        after: '2026-10-31T14:30:00Z',
      },
    ],
  },
  {
    id: 8,
    at: '2026-10-31T09:10:00Z',
    actor: null,
    kind: 'equipment',
    action: 'update',
    equipmentCode: 'U093',
    equipmentType: 'ضاغط هواء',
    href: '/equipment/eq-u093',
    changes: [
      { key: 'status', label: 'الحالة', before: 'نشطة', after: 'منتهية' },
      { key: 'is_active', label: 'مفعلة', before: 'نعم', after: 'لا' },
    ],
  },
  {
    id: 9,
    at: '2026-10-30T12:00:00Z',
    actor: 'مبارك بكرمان',
    kind: 'movement',
    action: 'delete',
    equipmentCode: 'A143',
    equipmentType: 'قلاب',
    href: '/movements/m-9',
    movement: { type: 'entry', context: 'site' },
    changes: [
      {
        key: 'company_id',
        label: 'الشركة',
        before: 'شركة الخليج للانشاءات',
        after: null,
      },
      {
        key: 'project_id',
        label: 'المشروع',
        before: 'برج الشمال',
        after: null,
      },
      { key: 'driver_id', label: 'السائق', before: 'سعد ناصر', after: null },
      {
        key: 'recorded_at',
        label: 'وقت الحركة',
        before: '2026-10-29T06:10:00Z',
        after: null,
      },
    ],
  },
  {
    id: 10,
    at: '2026-10-30T07:25:00Z',
    actor: 'مبارك بكرمان',
    kind: 'equipment',
    action: 'update',
    equipmentCode: 'A028',
    equipmentType: 'حفارة',
    href: '/equipment/eq-a028',
    changes: [
      {
        key: 'plate_number',
        label: 'اللوحة',
        before: '1128 XVV',
        after: '1128 XVU',
      },
    ],
  },
  {
    id: 11,
    at: '2026-10-28T10:15:00Z',
    actor: 'مبارك بكرمان',
    kind: 'equipment',
    action: 'delete',
    equipmentCode: 'U077',
    equipmentType: 'خلاطة',
    href: '/equipment/eq-u077',
    changes: [
      { key: 'type', label: 'النوع', before: 'خلاطة', after: null },
      {
        key: 'ownership_status',
        label: 'المالك',
        before: 'مالك اخر',
        after: null,
      },
      {
        key: 'lessor_id',
        label: 'المورد',
        before: 'مؤسسة الرواد للمعدات',
        after: null,
      },
    ],
  },
  {
    id: 12,
    at: '2026-10-27T13:50:00Z',
    actor: 'سالم العمري',
    kind: 'movement',
    action: 'update',
    equipmentCode: 'A028',
    equipmentType: 'حفارة',
    href: '/movements/m-12',
    movement: { type: 'entry', context: 'site' },
    changes: [
      {
        key: 'contractor_equipment_code',
        label: 'ترقيم الشركة',
        before: null,
        after: 'EX-17',
      },
    ],
  },
  {
    id: 13,
    at: '2026-10-20T06:00:00Z',
    actor: 'مبارك بكرمان',
    kind: 'equipment',
    action: 'update',
    equipmentCode: 'A028',
    equipmentType: 'حفارة',
    href: '/equipment/eq-a028',
    changes: [
      {
        key: 'tracker_unit_id',
        label: 'وحدة افاقي',
        before: null,
        after: '(A028) 7712 TRA',
      },
    ],
  },
  {
    id: 14,
    at: '2026-09-18T09:40:00Z',
    actor: 'مبارك بكرمان',
    kind: 'equipment',
    action: 'update',
    equipmentCode: 'A028',
    equipmentType: 'حفارة',
    href: '/equipment/eq-a028',
    changes: [
      {
        key: 'project_id',
        label: 'المشروع',
        before: 'برج الشمال',
        after: null,
      },
    ],
  },
  {
    id: 15,
    at: '2026-09-02T11:20:00Z',
    actor: 'مبارك بكرمان',
    kind: 'equipment',
    action: 'update',
    equipmentCode: 'A028',
    equipmentType: 'حفارة',
    href: '/equipment/eq-a028',
    changes: [
      { key: 'type', label: 'النوع', before: 'بوكلين', after: 'حفارة' },
      {
        key: 'chassis_number',
        label: 'رقم الشاصي',
        before: null,
        after: 'CAT0028X',
      },
    ],
  },
]

/** The last equipment changes of the card's unit, newest first. */
export function cardUnitChanges(limit: number): ActivityRow[] {
  return ACTIVITY_ROWS.filter(
    (row) => row.kind === 'equipment' && row.equipmentCode === CARD_UNIT.code,
  )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
}
