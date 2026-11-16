/**
 * The day columns of the visits Excel export (owner 2026-11-16: «نضيف اعمدة
 * الايام لاخر شهر … كل يوم يكون فيه 10 اذا كانت المعدة حاضرة, واختصارات اخرى
 * للورشة, بدون تسجيل», then «اعمدة الايام تكون اخر الاعمدة, وابغاك تسوي
 * المستخلص, بمعنا عدد الساعات, عدد بدون تسجيل, عدد الورشة»).
 *
 * Pure: no I/O and no imports, so the node tests load it directly. Every day
 * is a SAUDI day (UTC+03:00, no daylight saving).
 *
 * The rules, decided with the owner:
 *   - a day inside a project counts 10 hours, a Friday there shows F;
 *   - a day in the workshop shows W whatever its purpose, Fridays included;
 *   - a day no visit covers is A (بدون تسجيل) on the units sheet;
 *   - when several visits cover one day, the one that STARTED LAST owns it
 *     (the inquiry page's rule): a workshop stop nested in a project visit
 *     takes its days, and a unit that left one project and entered another
 *     on the same day is counted once, for the new one;
 *   - days after today, and days before the unit's first visit, stay empty
 *     and are counted nowhere.
 */

const SAUDI_OFFSET_MS = 3 * 60 * 60 * 1000

/** Hours of one day inside a project. */
export const DAY_HOURS = 10

export type DayKind =
  | 'site'
  | 'maintenance'
  | 'parking'
  | 'out_of_service'
  | 'unclassified'
  | 'unrecorded'
  | 'before'
  | 'future'

/** The workshop kinds, in the legend's order. */
export const WORKSHOP_DAY_KINDS = [
  'maintenance',
  'parking',
  'out_of_service',
  'unclassified',
] as const
export type WorkshopDayKind = (typeof WORKSHOP_DAY_KINDS)[number]

/** One visit, as `movement_visits` gives it. */
export interface GridVisit {
  entryId: string
  equipmentId: string
  context: 'site' | 'workshop'
  workshopPurpose: string | null
  /** ISO instant of the entry. */
  entryAt: string
  /** ISO instant of the exit that closed it, null while open. */
  exitAt: string | null
}

export interface GridDay {
  /** `YYYY-MM-DD`, a Saudi day. */
  day: string
  kind: DayKind
  /** The entry of the visit that owns the day, null when none does. */
  ownerEntryId: string | null
  friday: boolean
}

/** A cell of the sheet: hours, a letter, or empty. */
export type DayCell = number | string

// --- Saudi days and months --------------------------------------------------

/** The Saudi day of an instant, `YYYY-MM-DD`; '' for an unreadable value. */
export function saudiDayKeyOf(instant: string | number | Date): string {
  const ms =
    typeof instant === 'number'
      ? instant
      : instant instanceof Date
        ? instant.getTime()
        : Date.parse(instant)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + SAUDI_OFFSET_MS).toISOString().slice(0, 10)
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_KEY.test(value)
}

/** Every day of a `YYYY-MM` month, in order; [] for a bad key. */
export function monthDayKeys(monthKey: string): string[] {
  const match = MONTH_KEY.exec(monthKey)
  if (!match) return []
  const year = Number(match[1])
  const month = Number(match[2])
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from(
    { length: count },
    (_, index) => `${monthKey}-${String(index + 1).padStart(2, '0')}`,
  )
}

export function isFridayKey(dayKey: string): boolean {
  const ms = Date.parse(`${dayKey}T00:00:00Z`)
  return Number.isFinite(ms) && new Date(ms).getUTCDay() === 5
}

/** The month of an instant in Saudi time, `YYYY-MM`. */
export function saudiMonthKeyOf(instant: string | number | Date): string {
  return saudiDayKeyOf(instant).slice(0, 7)
}

/** The month `back` months before a `YYYY-MM` month (0 = itself). */
export function shiftMonthKey(monthKey: string, back: number): string {
  const match = MONTH_KEY.exec(monthKey)
  if (!match) return monthKey
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1 - back, 1),
  )
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The Saudi month before the current one: the default of the day columns. */
export function previousMonthKey(now: number | Date = Date.now()): string {
  return shiftMonthKey(saudiMonthKeyOf(now), 1)
}

/** This month and the `count - 1` before it, newest first. */
export function recentMonthKeys(
  now: number | Date = Date.now(),
  count = 12,
): string[] {
  const current = saudiMonthKeyOf(now)
  return Array.from({ length: Math.max(1, count) }, (_, index) =>
    shiftMonthKey(current, index),
  )
}

/**
 * The month a date filter names: both ends given and inside ONE month.
 * Accepts day keys or ISO instants; anything else answers null.
 */
export function monthKeyOfRange(
  from: string | null | undefined,
  to: string | null | undefined,
): string | null {
  if (!from || !to) return null
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : saudiDayKeyOf(from)
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : saudiDayKeyOf(to)
  if (!start || !end) return null
  const month = start.slice(0, 7)
  return month === end.slice(0, 7) && isMonthKey(month) ? month : null
}

/**
 * The month of the day columns: the first date filter that names one month,
 * else the previous Saudi month.
 */
export function exportDaysMonth(
  ranges: ReadonlyArray<{ from?: string | null; to?: string | null }>,
  now: number | Date = Date.now(),
): string {
  for (const range of ranges) {
    const month = monthKeyOfRange(range.from, range.to)
    if (month) return month
  }
  return previousMonthKey(now)
}

/** The month's first and last instants (Saudi days), for a database query. */
export function monthBounds(monthKey: string): { start: string; end: string } {
  const days = monthDayKeys(monthKey)
  if (days.length === 0) return { start: '', end: '' }
  return {
    start: `${days[0]}T00:00:00.000+03:00`,
    end: `${days[days.length - 1]}T23:59:59.999+03:00`,
  }
}

// --- The state of each day --------------------------------------------------

function workshopKind(purpose: string | null): WorkshopDayKind {
  return purpose === 'maintenance' ||
    purpose === 'parking' ||
    purpose === 'out_of_service'
    ? purpose
    : 'unclassified'
}

interface Span {
  visit: GridVisit
  from: string
  to: string
  startMs: number
}

function spansOf(visits: readonly GridVisit[], todayKey: string): Span[] {
  const spans: Span[] = []
  for (const visit of visits) {
    const from = saudiDayKeyOf(visit.entryAt)
    if (!from) continue
    const to = visit.exitAt ? saudiDayKeyOf(visit.exitAt) || from : todayKey
    spans.push({
      visit,
      from,
      to: to < from ? from : to,
      startMs: Date.parse(visit.entryAt),
    })
  }
  return spans
}

/** The later start wins; the entry id breaks a tie, like `(recorded_at, id)`. */
function startsLater(a: Span, b: Span): boolean {
  if (a.startMs !== b.startMs) return a.startMs > b.startMs
  return a.visit.entryId > b.visit.entryId
}

/**
 * Where ONE unit was on each day of the month.
 *
 * `visits`: the unit's visits that touch the month, both contexts.
 * `hadEarlierVisit`: the unit has a visit that started before the month (so
 * an uncovered day at the start of the month is «بدون تسجيل», not «before»).
 */
export function unitMonthDays(
  visits: readonly GridVisit[],
  monthKey: string,
  now: number | Date = Date.now(),
  hadEarlierVisit = false,
): GridDay[] {
  const todayKey = saudiDayKeyOf(now)
  const spans = spansOf(visits, todayKey)
  const firstDay = spans.reduce<string | null>(
    (first, span) => (first === null || span.from < first ? span.from : first),
    null,
  )
  return monthDayKeys(monthKey).map((day) => {
    const friday = isFridayKey(day)
    if (day > todayKey)
      return { day, kind: 'future', ownerEntryId: null, friday }
    let owner: Span | null = null
    for (const span of spans) {
      if (span.from > day || span.to < day) continue
      if (owner === null || startsLater(span, owner)) owner = span
    }
    if (owner === null) {
      const known = hadEarlierVisit || (firstDay !== null && day >= firstDay)
      return {
        day,
        kind: known ? 'unrecorded' : 'before',
        ownerEntryId: null,
        friday,
      }
    }
    return {
      day,
      kind:
        owner.visit.context === 'site'
          ? 'site'
          : workshopKind(owner.visit.workshopPurpose),
      ownerEntryId: owner.visit.entryId,
      friday,
    }
  })
}

// --- Cells ------------------------------------------------------------------

export interface DayCodes {
  /** A day in the workshop, whatever its purpose. */
  workshop: string
  /** A day no visit covers («بدون تسجيل»). */
  unrecorded: string
  /** A Friday inside a project: no hours. */
  friday: string
}

/**
 * The letters of the sheet, the same in both languages (owner 2026-11-16,
 * «الورشة "W" بدون تسجيل "A" بدون صيانة ووقوف»): W = the workshop, with no
 * letter per purpose, and A = no record. The first version had ص / ق / خ / و
 * per purpose and «-». F = a Friday inside a project («الجمعة حط F», the
 * same day; it was an empty cell): it counts no hours.
 */
export const DAY_CODES: DayCodes = {
  workshop: 'W',
  unrecorded: 'A',
  friday: 'F',
}

/** How a day cell is coloured in the file (light fills, owner 2026-11-16). */
export type DayCellTone = 'hours' | 'workshop' | 'unrecorded' | 'friday'

export function dayCellTone(
  cell: DayCell | null | undefined,
  codes: DayCodes = DAY_CODES,
): DayCellTone | null {
  if (typeof cell === 'number') return 'hours'
  if (cell === codes.workshop) return 'workshop'
  if (cell === codes.unrecorded) return 'unrecorded'
  if (cell === codes.friday) return 'friday'
  return null
}

export function dayCodes(): DayCodes {
  return DAY_CODES
}

function isWorkshopKind(kind: DayKind): kind is WorkshopDayKind {
  return (WORKSHOP_DAY_KINDS as readonly string[]).includes(kind)
}

/** The units sheet: the whole month of one unit. */
export function unitDayCell(day: GridDay, codes: DayCodes): DayCell {
  if (day.kind === 'site') return day.friday ? codes.friday : DAY_HOURS
  if (isWorkshopKind(day.kind)) return codes.workshop
  if (day.kind === 'unrecorded') return codes.unrecorded
  return ''
}

/**
 * Which project visit each workshop visit of ONE unit is shown on (owner
 * 2026-11-16, «ضمّن ايام الورشة في تصدير المشاريع»): the project visit the
 * unit came from — the one that started last at or before the workshop
 * entry, whether the workshop stay is a stop nested in it or follows its
 * exit — and, when the unit has none before it, the first project visit
 * after it. So a workshop day appears on ONE project row, never on two.
 * Keys are workshop entry ids, values project entry ids.
 */
export function workshopParents(
  visits: readonly GridVisit[],
): Map<string, string> {
  const startOf = (visit: GridVisit) => Date.parse(visit.entryAt)
  const before = (a: GridVisit, b: GridVisit) => {
    const diff = startOf(a) - startOf(b)
    return diff !== 0 ? diff < 0 : a.entryId < b.entryId
  }
  const sites = visits.filter(
    (visit) => visit.context === 'site' && Number.isFinite(startOf(visit)),
  )
  const parents = new Map<string, string>()
  for (const stop of visits) {
    if (stop.context !== 'workshop' || !Number.isFinite(startOf(stop))) continue
    let previous: GridVisit | null = null
    let next: GridVisit | null = null
    for (const site of sites) {
      if (before(site, stop)) {
        if (previous === null || before(previous, site)) previous = site
      } else if (next === null || before(site, next)) next = site
    }
    const parent = previous ?? next
    if (parent) parents.set(stop.entryId, parent.entryId)
  }
  return parents
}

/**
 * The visits sheet: the days of ONE visit's row. A project visit shows 10 on
 * the days it owns and the workshop letter on the days of the workshop
 * visits that belong to it (`workshopParents`: inside the visit or after its
 * exit; without `parents`, only the stops inside its own span); a workshop
 * visit shows its letter on the days it owns. Every other cell is empty.
 */
export function visitDayCell(
  day: GridDay,
  visit: Pick<GridVisit, 'entryId' | 'context' | 'entryAt' | 'exitAt'>,
  codes: DayCodes,
  now: number | Date = Date.now(),
  parents?: ReadonlyMap<string, string>,
): DayCell {
  const from = saudiDayKeyOf(visit.entryAt)
  const to = visit.exitAt ? saudiDayKeyOf(visit.exitAt) : saudiDayKeyOf(now)
  const inside = Boolean(from) && day.day >= from && day.day <= to
  if (visit.context === 'site') {
    if (isWorkshopKind(day.kind)) {
      const mine = parents
        ? day.ownerEntryId !== null &&
          parents.get(day.ownerEntryId) === visit.entryId
        : inside
      return mine ? codes.workshop : ''
    }
    if (!inside || day.kind !== 'site' || day.ownerEntryId !== visit.entryId)
      return ''
    return day.friday ? codes.friday : DAY_HOURS
  }
  return inside &&
    isWorkshopKind(day.kind) &&
    day.ownerEntryId === visit.entryId
    ? codes.workshop
    : ''
}

// --- المستخلص ---------------------------------------------------------------

export interface DaySummary {
  /** Hours inside projects: 10 a day, Fridays excluded. */
  hours: number
  /** Days in the workshop, whatever the purpose. */
  workshopDays: number
  /** Days no visit covers («بدون تسجيل»). */
  unrecordedDays: number
}

/** The totals of one row, counted from the very cells the sheet shows. */
export function summarizeDayCells(
  cells: readonly DayCell[],
  codes: DayCodes,
): DaySummary {
  let hours = 0
  let workshopDays = 0
  let unrecordedDays = 0
  for (const cell of cells) {
    if (typeof cell === 'number') hours += cell
    else if (cell === codes.unrecorded) unrecordedDays += 1
    else if (cell === codes.workshop) workshopDays += 1
  }
  return { hours, workshopDays, unrecordedDays }
}

/** Groups visits by unit, keeping each unit's list in entry order. */
export function visitsByUnit(
  visits: readonly GridVisit[],
): Map<string, GridVisit[]> {
  const map = new Map<string, GridVisit[]>()
  const ordered = [...visits].sort(
    (a, b) =>
      Date.parse(a.entryAt) - Date.parse(b.entryAt) ||
      (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0),
  )
  for (const visit of ordered) {
    const list = map.get(visit.equipmentId)
    if (list) list.push(visit)
    else map.set(visit.equipmentId, [visit])
  }
  return map
}
