// Report and dashboard days follow Saudi time. Saudi Arabia stays on UTC+03:00
// all year (no daylight saving), so a fixed offset is exact.
const SAUDI_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export type ReportPeriod = 'today' | 'week' | 'month'

/** Calendar date (YYYY-MM-DD) of an instant in Saudi time. */
export function saudiDateKey(instant: Date | string = new Date()): string {
  return new Date(new Date(instant).getTime() + SAUDI_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
}

export function isDateKey(value: string | null | undefined): value is string {
  return (
    !!value &&
    DATE_KEY.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  )
}

/** First instant of a Saudi calendar day, as an ISO timestamp. */
export function saudiDayStart(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00+03:00`).toISOString()
}

/** Last instant (inclusive) of a Saudi calendar day, as an ISO timestamp. */
export function saudiDayEnd(dateKey: string): string {
  return new Date(
    new Date(`${dateKey}T00:00:00+03:00`).getTime() + DAY_MS - 1,
  ).toISOString()
}

/** Saudi date keys for a preset period ending today; weeks start on Monday. */
export function saudiPeriodKeys(period: ReportPeriod): {
  from: string
  to: string
} {
  const today = saudiDateKey()
  if (period === 'today') return { from: today, to: today }
  if (period === 'month') return { from: `${today.slice(0, 8)}01`, to: today }
  const date = new Date(`${today}T00:00:00Z`)
  const day = date.getUTCDay()
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1))
  return { from: date.toISOString().slice(0, 10), to: today }
}

const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** The UTC midnight of the 1st of the Saudi calendar month `monthsBack`
 *  months before the month of `today` (0 = this month). */
function monthStartBack(monthsBack: number, today: string): Date {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7)) - 1
  return new Date(Date.UTC(year, month - monthsBack, 1))
}

/**
 * Saudi date keys of a whole calendar month `monthsBack` months before the
 * current one: 0 = this month (1st → today), 1 = the previous month (1st →
 * its last day), 2 = the month before that, and so on. Pure date-key / UTC
 * arithmetic, so year boundaries and February's length come out right.
 */
export function saudiMonthKeys(
  monthsBack: number,
  today: string = saudiDateKey(),
): { from: string; to: string } {
  const start = monthStartBack(monthsBack, today)
  const from = start.toISOString().slice(0, 10)
  if (monthsBack <= 0) return { from, to: today }
  const last = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  )
  return { from, to: last.toISOString().slice(0, 10) }
}

/** The month preset's label, the same in every UI language: the English
 *  three-letter month and its number, e.g. "Oct (10)". */
export function monthPresetLabel(
  monthsBack: number,
  today: string = saudiDateKey(),
): string {
  const index = monthStartBack(monthsBack, today).getUTCMonth()
  return `${MONTH_ABBREVIATIONS[index]} (${index + 1})`
}

/** The month presets of the list filters' date range, in tab order oldest
 *  first (owner 2026-10-31), and how many months each one lies before the
 *  current Saudi month. */
export type MonthPreset = 'month' | 'last_month' | 'month_before_last'

export const MONTH_PRESETS: readonly MonthPreset[] = [
  'month_before_last',
  'last_month',
  'month',
]

export const MONTH_PRESET_BACK: Record<MonthPreset, number> = {
  month: 0,
  last_month: 1,
  month_before_last: 2,
}
