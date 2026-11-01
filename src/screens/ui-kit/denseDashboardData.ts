// Sample data for «نموذج لوحة التحكم الكثيفة» (/ui-kit, owner request
// 2026-11-01, EM-252: «الارقام الحالية ماخذه كامل الصفحة»). Every figure here
// adds up with the others so the owner can read the mockup as one picture:
// the fleet = in projects + in the workshop + available, the owners' counts
// sum to the fleet, and the workshop states sum to the workshop count.
// Nothing here reads Supabase.

import type { WorkshopPurpose } from '@/lib/equipmentState'

export type OwnerRow = {
  id: 'alazani' | 'takween' | 'third_party_f' | 'third_party_b' | 'other'
  label: string
  fleet: number
  inProjects: number
  /** Index into the chart tint pair (`--chart-N` / `--chart-stroke-N`). */
  shade: 1 | 2 | 3 | 4 | 5 | 6
}

/** The five owners, in the order the home shows them (`OwnerTotalsSection`
 *  pairs each with the same chart shade). */
export const OWNERS: OwnerRow[] = [
  { id: 'alazani', label: 'العزاني', fleet: 142, inProjects: 88, shade: 1 },
  { id: 'takween', label: 'تكوين', fleet: 38, inProjects: 24, shade: 3 },
  {
    id: 'third_party_f',
    label: 'طرف ثالث F',
    fleet: 47,
    inProjects: 33,
    shade: 2,
  },
  {
    id: 'third_party_b',
    label: 'طرف ثالث B',
    fleet: 21,
    inProjects: 14,
    shade: 5,
  },
  { id: 'other', label: 'مالك اخر', fleet: 37, inProjects: 27, shade: 4 },
]

export const FLEET_TOTAL = OWNERS.reduce((sum, row) => sum + row.fleet, 0) // 285
export const IN_PROJECTS = OWNERS.reduce((sum, row) => sum + row.inProjects, 0) // 186

export type RestState = {
  id: WorkshopPurpose | 'unclassified' | 'available'
  label: string
  count: number
  /** Fill and outline tokens; light tints with a readable outline. */
  fill: string
  stroke: string
}

/** «حالات المتبقي»: the fleet minus the projects, by state. */
export const REST_STATES: RestState[] = [
  {
    id: 'maintenance',
    label: 'صيانة',
    count: 28,
    fill: 'var(--chart-2)',
    stroke: 'var(--chart-stroke-2)',
  },
  {
    id: 'parking',
    label: 'انتظار',
    count: 17,
    fill: 'var(--chart-3)',
    stroke: 'var(--chart-stroke-3)',
  },
  {
    id: 'out_of_service',
    label: 'خارج الخدمة',
    count: 12,
    fill: 'var(--danger-soft)',
    stroke: 'var(--danger)',
  },
  {
    id: 'unclassified',
    label: 'غير مصنفة',
    count: 4,
    fill: 'var(--chart-4)',
    stroke: 'var(--chart-stroke-4)',
  },
  {
    id: 'available',
    label: 'متاحة',
    count: 38,
    fill: 'var(--chart-1)',
    stroke: 'var(--chart-stroke-1)',
  },
]

export const IN_WORKSHOP = REST_STATES.filter(
  (state) => state.id !== 'available',
).reduce((sum, state) => sum + state.count, 0) // 61
export const AVAILABLE =
  REST_STATES.find((state) => state.id === 'available')?.count ?? 0 // 38

/** «الموردون في المشاريع»: the 27 «مالك اخر» units inside projects. */
export const SUPPLIERS_IN_PROJECTS = [
  { id: 's1', name: 'شركة الخليج للمعدات', count: 9 },
  { id: 's2', name: 'مؤسسة النخيل', count: 7 },
  { id: 's3', name: 'الصحراء للتاجير', count: 5 },
  { id: 's4', name: 'البحر الاحمر', count: 3 },
  { id: 'none', name: 'بدون مورد', count: 3 },
]

/** «الاكثر طلبا حسب النوع»: units inside projects, by type. */
export const TOP_TYPES = [
  { id: 'dump', label: 'DUMP TRUCK', count: 44 },
  { id: 'exc', label: 'EXCAVATOR', count: 35 },
  { id: 'loader', label: 'WHEEL LOADER', count: 16 },
  { id: 'tanker', label: 'WATER TANKER', count: 13 },
  { id: 'crane', label: 'CRANE', count: 10 },
  { id: 'grader', label: 'GRADER', count: 8 },
]

export const AFAQY = {
  linked: 214,
  connected: 188,
  notConnected: 19,
  noSignal: 7,
}

export const PURCHASING = { noPo: 12, awaitingApproval: 3, unpriced: 5 }

export type WorkshopRow = {
  code: string
  type: string
  purpose: WorkshopPurpose | null
  since: string
}

/** «في الورشة»: the newest open workshop visits. */
export const WORKSHOP_ROWS: WorkshopRow[] = [
  { code: 'A055', type: 'EXCAVATOR', purpose: 'maintenance', since: 'يومين' },
  { code: 'TK012', type: 'DUMP TRUCK', purpose: 'parking', since: '5 ايام' },
  { code: 'A291', type: 'WHEEL LOADER', purpose: null, since: '3 ساعات' },
  { code: 'F018', type: 'CRANE', purpose: 'out_of_service', since: '41 يوما' },
  { code: 'A140', type: 'DUMP TRUCK', purpose: 'maintenance', since: 'اسبوع' },
  { code: 'B007', type: 'GRADER', purpose: 'parking', since: '12 يوما' },
  { code: 'A233', type: 'WATER TANKER', purpose: null, since: 'يوم' },
  { code: 'A078', type: 'EXCAVATOR', purpose: 'maintenance', since: '3 ايام' },
  { code: 'TK031', type: 'BULLDOZER', purpose: 'out_of_service', since: 'شهر' },
  { code: 'A112', type: 'DUMP TRUCK', purpose: 'parking', since: '9 ايام' },
]

export type DayPoint = {
  key: string
  label: string
  title: string
  entries: number
  exits: number
}

// Thirty days ending on 2026-11-01 (the mockup's day). Fixed figures, no
// randomness, so the chart looks the same on every review.
const ENTRIES_30 = [
  5, 8, 6, 9, 4, 0, 7, 10, 6, 8, 11, 5, 0, 9, 12, 7, 6, 10, 8, 0, 7, 9, 13, 6,
  8, 11, 7, 0, 9, 10,
]
const EXITS_30 = [
  3, 6, 5, 7, 4, 0, 5, 8, 6, 5, 9, 4, 0, 7, 10, 6, 5, 8, 7, 0, 6, 7, 11, 5, 6,
  9, 6, 0, 8, 7,
]

export const DAYS_30: DayPoint[] = ENTRIES_30.map((entries, index) => {
  const day = new Date(Date.UTC(2026, 10, 1))
  day.setUTCDate(day.getUTCDate() - (ENTRIES_30.length - 1 - index))
  const dd = String(day.getUTCDate()).padStart(2, '0')
  const mm = String(day.getUTCMonth() + 1).padStart(2, '0')
  return {
    key: `${day.getUTCFullYear()}-${mm}-${dd}`,
    label: `${dd}/${mm}`,
    title: `${dd}/${mm}/${day.getUTCFullYear()}`,
    entries,
    exits: EXITS_30[index],
  }
})

export const ENTRIES_30_TOTAL = ENTRIES_30.reduce(
  (sum, value) => sum + value,
  0,
)
export const EXITS_30_TOTAL = EXITS_30.reduce((sum, value) => sum + value, 0)

export function shareOf(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : '0%'
}
