// The inquiry page's year (owner 2026-10-26, approved on /ui-kit «نموذج
// صفحة الاستعلام الجديدة»; a calendar year since 2026-10-27, «المفروض
// بالسنة»): every Saudi calendar day of the chosen year in the state the
// unit was in, and the days grouped by calendar month. Pure and import-free (type imports only),
// so tests/inquiryYear.test.cjs loads it directly.

import type { EquipmentVisit } from './visitTimeline'

/** One colour per state on the page. «بدون تسجيل» is a general state: no
 *  stay was recorded that day, wherever the unit was («مو شرط انها على
 *  الطريق … خليها حالة عامة»). */
export type InquiryStateKey =
  | 'site'
  | 'maintenance'
  | 'parking'
  | 'out_of_service'
  | 'unrecorded'

/** The order states stack in, first at the start of a ring. */
export const INQUIRY_STATE_ORDER: readonly InquiryStateKey[] = [
  'site',
  'maintenance',
  'parking',
  'out_of_service',
  'unrecorded',
]

const DAY_MS = 24 * 60 * 60 * 1000
const SAUDI_OFFSET_MS = 3 * 60 * 60 * 1000

/** Days since the epoch of an instant's Saudi calendar day (UTC+03:00). */
export function saudiDay(ms: number): number {
  return Math.floor((ms + SAUDI_OFFSET_MS) / DAY_MS)
}

/** The Saudi calendar year of an instant. */
export function saudiYear(ms: number): number {
  return new Date(saudiDay(ms) * DAY_MS).getUTCFullYear()
}

export interface InquiryYearRange {
  /** Saudi day index of 1 January. */
  firstDay: number
  /** Saudi day index of 31 December. */
  lastDay: number
  /** The instants to read the year's movements between: Saudi midnight of
   *  1 January, and the Saudi midnight after the year's last day or today,
   *  whichever comes first. */
  startMs: number
  endMs: number
}

/** A calendar year in Saudi time (owner 2026-10-27: «المفروض بالسنة»). */
export function inquiryYearRange(year: number, now: number): InquiryYearRange {
  const firstDay = Date.UTC(year, 0, 1) / DAY_MS
  const lastDay = Date.UTC(year, 11, 31) / DAY_MS
  const readUntil = Math.min(lastDay, saudiDay(now))
  return {
    firstDay,
    lastDay,
    startMs: firstDay * DAY_MS - SAUDI_OFFSET_MS,
    endMs: (readUntil + 1) * DAY_MS - SAUDI_OFFSET_MS,
  }
}

/** The years a reader may pick, newest first: from this year back to the
 *  unit's first year (its first movement or its creation, the earlier). */
export function inquiryYearChoices(firstYear: number | null, now: number): number[] {
  const current = saudiYear(now)
  const from = firstYear !== null && firstYear <= current ? firstYear : current
  const years: number[] = []
  for (let year = current; year >= from; year -= 1) years.push(year)
  return years
}

/** The state of a stay: a project, else the workshop by its purpose (an
 *  unclassified workshop entry counts as maintenance). */
export function visitStateKey(visit: EquipmentVisit): InquiryStateKey {
  if (visit.context === 'site') return 'site'
  const purpose = visit.entry?.workshop_purpose
  if (purpose === 'parking') return 'parking'
  if (purpose === 'out_of_service') return 'out_of_service'
  return 'maintenance'
}

export interface InquiryDay {
  /** Days since the epoch of the Saudi calendar day. */
  day: number
  /** `before`: the unit did not exist yet; `future`: after today. */
  state: InquiryStateKey | 'before' | 'future'
  visit: EquipmentVisit | null
}

/**
 * Every Saudi day of a calendar year with the state it was in: the latest
 * stay covering it, else «بدون تسجيل», `before` until the unit was added,
 * `future` after today. A stay counts on its entry day, its exit day and
 * every day between (an open stay through today); a lone legacy exit has no
 * start and colours nothing.
 */
export function inquiryYearDays(
  visits: readonly EquipmentVisit[],
  createdAt: number,
  now: number,
  year: number,
): InquiryDay[] {
  const { firstDay, lastDay } = inquiryYearRange(year, now)
  const today = saudiDay(now)
  const created = Number.isFinite(createdAt) ? saudiDay(createdAt) : firstDay
  const days: InquiryDay[] = []
  for (let day = firstDay; day <= lastDay; day += 1)
    days.push({
      day,
      state: day > today ? 'future' : day < created ? 'before' : 'unrecorded',
      visit: null,
    })
  const last = Math.min(lastDay, today)
  // `buildEquipmentVisits` is newest first: walk oldest first so a later
  // stay on the same day wins.
  for (const visit of [...visits].reverse()) {
    if (!visit.startedAt) continue
    const start = Date.parse(visit.startedAt)
    if (Number.isNaN(start)) continue
    const end = visit.endedAt ? Date.parse(visit.endedAt) : now
    const from = Math.max(saudiDay(start), firstDay)
    const to = Math.min(Number.isNaN(end) ? today : saudiDay(end), last)
    for (let day = from; day <= to; day += 1) {
      days[day - firstDay].state = visitStateKey(visit)
      days[day - firstDay].visit = visit
    }
  }
  return days
}

export interface InquiryMonth {
  /** `YYYY-M` (0-based month). */
  key: string
  year: number
  /** 0-based. */
  month: number
  daysInMonth: number
  /** The month's days inside the window. */
  days: InquiryDay[]
  counts: Record<InquiryStateKey, number>
}

function emptyCounts(): Record<InquiryStateKey, number> {
  return { site: 0, maintenance: 0, parking: 0, out_of_service: 0, unrecorded: 0 }
}

/** The year's days by calendar month, January first. */
export function inquiryYearMonths(days: readonly InquiryDay[]): InquiryMonth[] {
  const months: InquiryMonth[] = []
  for (const day of days) {
    const date = new Date(day.day * DAY_MS)
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    const key = `${year}-${month}`
    let group = months[months.length - 1]
    if (!group || group.key !== key) {
      group = {
        key,
        year,
        month,
        daysInMonth: new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
        days: [],
        counts: emptyCounts(),
      }
      months.push(group)
    }
    group.days.push(day)
    if (day.state !== 'before' && day.state !== 'future') group.counts[day.state] += 1
  }
  return months
}

export interface InquiryYearSummary {
  counts: Record<InquiryStateKey, number>
  /** Days the unit existed in the window. */
  counted: number
  siteDays: number
  /** Maintenance, standby and out of service together. */
  workshopDays: number
  unrecordedDays: number
  /** Stays with at least one day in the window. */
  visitCount: number
  /** Whole percent of the counted days spent in a project. */
  siteShare: number
}

/** The numbers above the rings, counted from the same days so they always
 *  match them. */
export function summarizeInquiryYear(days: readonly InquiryDay[]): InquiryYearSummary {
  const counts = emptyCounts()
  const visits = new Set<string>()
  let counted = 0
  for (const day of days) {
    if (day.state === 'before' || day.state === 'future') continue
    counted += 1
    counts[day.state] += 1
    if (day.visit) visits.add(day.visit.key)
  }
  return {
    counts,
    counted,
    siteDays: counts.site,
    workshopDays: counts.maintenance + counts.parking + counts.out_of_service,
    unrecordedDays: counts.unrecorded,
    visitCount: visits.size,
    siteShare: counted > 0 ? Math.round((counts.site / counted) * 100) : 0,
  }
}
