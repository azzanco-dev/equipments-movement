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
