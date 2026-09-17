// Pure calendar math for DatePicker. Unlike src/lib/saudiTime.ts (which maps
// an instant to a Saudi calendar day), everything here operates only on
// YYYY-MM-DD date keys and plain year/month numbers — no timezone
// conversion. UTC arithmetic is used purely as an overflow-safe calendar
// (no instant is ever read from the local clock here).
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 24 * 60 * 60 * 1000

export interface DateKeyParts {
  year: number
  month: number // 1-12
  day: number
}

/** Parses a date key, rejecting malformed or impossible calendar dates
 * (e.g. 2026-02-30) rather than silently rolling them over. */
export function parseDateKey(value: string): DateKeyParts | null {
  const match = DATE_KEY.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = Date.UTC(year, month - 1, day)
  const check = new Date(utc)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    return null
  return { year, month, day }
}

export function isValidDateKey(value: string | null | undefined): boolean {
  return !!value && parseDateKey(value) !== null
}

export function formatDateKey(
  year: number,
  month: number,
  day: number,
): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Number of days in a month; `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Weekday of the first day of the month: 0 = Sunday .. 6 = Saturday. */
export function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
}

/** Weekday of a date key: 0 = Sunday .. 6 = Saturday. Returns null if invalid. */
export function weekdayOfDateKey(dateKey: string): number | null {
  const parts = parseDateKey(dateKey)
  if (!parts) return null
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

/** Adds `delta` months to a year/month pair, wrapping the year as needed. */
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta
  const y = Math.floor(total / 12)
  const m = ((total % 12) + 12) % 12
  return { year: y, month: m + 1 }
}

/** Adds `delta` days to a date key. Returns null if the key is invalid. */
export function addDaysToDateKey(
  dateKey: string,
  delta: number,
): string | null {
  const parts = parseDateKey(dateKey)
  if (!parts) return null
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day) + delta * DAY_MS
  const d = new Date(utc)
  return formatDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Adds `delta` months to a date key, clamping the day into the target
 * month (e.g. 31 Jan + 1 month -> 28/29 Feb). Returns null if invalid. */
export function addMonthsToDateKey(
  dateKey: string,
  delta: number,
): string | null {
  const parts = parseDateKey(dateKey)
  if (!parts) return null
  const { year, month } = addMonths(parts.year, parts.month, delta)
  const day = Math.min(parts.day, daysInMonth(year, month))
  return formatDateKey(year, month, day)
}

/** Start (Sunday) of the calendar week containing `dateKey`. */
export function startOfWeek(dateKey: string): string | null {
  const weekday = weekdayOfDateKey(dateKey)
  if (weekday === null) return null
  return addDaysToDateKey(dateKey, -weekday)
}

/** End (Saturday) of the calendar week containing `dateKey`. */
export function endOfWeek(dateKey: string): string | null {
  const start = startOfWeek(dateKey)
  return start ? addDaysToDateKey(start, 6) : null
}

/** -1 if a < b, 1 if a > b, 0 if equal (plain string/lexicographic compare,
 * which sorts correctly for zero-padded YYYY-MM-DD keys). */
export function compareDateKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export interface CalendarDay {
  dateKey: string
  day: number
}

/** Grid cells for one month; leading blanks (week starts Sunday) are null. */
export function buildMonthGrid(
  year: number,
  month: number,
): Array<CalendarDay | null> {
  const total = daysInMonth(year, month)
  const startPad = firstWeekdayOfMonth(year, month)
  const cells: Array<CalendarDay | null> = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let day = 1; day <= total; day++)
    cells.push({ dateKey: formatDateKey(year, month, day), day })
  return cells
}
