// Bucketing for the home entries line chart.
//
// The caller passes a Saudi calendar range (two YYYY-MM-DD date keys) and gets
// back one bucket per point on the chart. Granularity follows the length of
// the range: a month shows its days, a year shows months, and a custom range
// picks days, weeks or months automatically. Every bucket also carries the
// Saudi day bounds (UTC+03:00) a real query would filter on, so the chart and
// the reports always agree on where a day starts.
//
// Pure date math: nothing here reads the clock, so the same range always
// produces the same buckets.
import {
  addDaysToDateKey,
  compareDateKeys,
  daysInMonth,
  formatDateKey,
  parseDateKey,
  weekdayOfDateKey,
} from './calendar'
import { saudiDayEnd, saudiDayStart } from './saudiTime'

export type ChartBucketUnit = 'day' | 'week' | 'month'
export type ChartBucketLang = 'ar' | 'en'

export interface ChartBucket {
  /** Stable identity: the first day of the bucket, or YYYY-MM for a month. */
  key: string
  unit: ChartBucketUnit
  /** First Saudi calendar day inside the bucket, clamped to the range. */
  fromKey: string
  /** Last Saudi calendar day inside the bucket, clamped to the range. */
  toKey: string
  /** The same bounds as instants, inclusive, for a real query. */
  fromIso: string
  toIso: string
  /** Days actually covered, so a clamped first or last bucket stays honest. */
  days: number
}

/** Up to this many days a range is drawn day by day. */
export const CHART_BUCKET_DAY_MAX_DAYS = 45
/** Up to this many days a range is drawn week by week; longer is monthly. */
export const CHART_BUCKET_WEEK_MAX_DAYS = 183

/** Hard stop so a mistyped range can never build an unbounded array. */
const MAX_BUCKETS = 400

const DAY_MS = 24 * 60 * 60 * 1000

// Gregorian month names. Arabic here follows the project rule of writing alif
// without hamza or madda.
const MONTH_NAMES: Record<ChartBucketLang, readonly string[]> = {
  ar: [
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
  ],
  en: [
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
  ],
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** Inclusive day count of a range; 0 when either key is invalid or reversed. */
export function chartRangeDays(from: string, to: string): number {
  const start = parseDateKey(from)
  const end = parseDateKey(to)
  if (!start || !end) return 0
  const startMs = Date.UTC(start.year, start.month - 1, start.day)
  const endMs = Date.UTC(end.year, end.month - 1, end.day)
  if (endMs < startMs) return 0
  return Math.round((endMs - startMs) / DAY_MS) + 1
}

/** Granularity a range is drawn at when the caller does not force one. */
export function chartBucketUnit(from: string, to: string): ChartBucketUnit {
  const days = chartRangeDays(from, to)
  if (days <= CHART_BUCKET_DAY_MAX_DAYS) return 'day'
  if (days <= CHART_BUCKET_WEEK_MAX_DAYS) return 'week'
  return 'month'
}

/** Monday that starts the week containing `dateKey`, matching the Monday
 *  weeks used by `saudiPeriodKeys('week')`. */
function startOfMondayWeek(dateKey: string): string | null {
  const weekday = weekdayOfDateKey(dateKey)
  if (weekday === null) return null
  return addDaysToDateKey(dateKey, -(weekday === 0 ? 6 : weekday - 1))
}

/**
 * Buckets covering `from`..`to` inclusively. The first and last bucket are
 * clamped to the range, so a month that starts mid-week never reports days
 * outside the period the user selected.
 *
 * Pass `unit` to force a granularity — the "this year" preset forces months
 * so early January still shows a monthly chart instead of weeks.
 */
export function buildChartBuckets(
  from: string,
  to: string,
  unit?: ChartBucketUnit,
): ChartBucket[] {
  if (!parseDateKey(from) || !parseDateKey(to)) return []
  if (compareDateKeys(from, to) > 0) return []

  const resolved = unit ?? chartBucketUnit(from, to)
  const buckets: ChartBucket[] = []
  let cursor = from

  while (compareDateKeys(cursor, to) <= 0 && buckets.length < MAX_BUCKETS) {
    const parts = parseDateKey(cursor)
    if (!parts) break

    let key = cursor
    let spanEnd = cursor
    if (resolved === 'week') {
      const weekStart = startOfMondayWeek(cursor) ?? cursor
      key = weekStart
      spanEnd = addDaysToDateKey(weekStart, 6) ?? cursor
    } else if (resolved === 'month') {
      key = `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}`
      spanEnd = formatDateKey(
        parts.year,
        parts.month,
        daysInMonth(parts.year, parts.month),
      )
    }

    const toKey = compareDateKeys(spanEnd, to) > 0 ? to : spanEnd
    buckets.push({
      key,
      unit: resolved,
      fromKey: cursor,
      toKey,
      fromIso: saudiDayStart(cursor),
      toIso: saudiDayEnd(toKey),
      days: chartRangeDays(cursor, toKey),
    })

    const next = addDaysToDateKey(toKey, 1)
    if (!next) break
    cursor = next
  }

  return buckets
}

/** Short axis label: "DD/MM" for a day or a week, the month name otherwise. */
export function chartBucketLabel(
  bucket: ChartBucket,
  lang: ChartBucketLang = 'ar',
): string {
  const parts = parseDateKey(bucket.fromKey)
  if (!parts) return bucket.key
  if (bucket.unit === 'month') return MONTH_NAMES[lang][parts.month - 1]
  return `${pad2(parts.day)}/${pad2(parts.month)}`
}

/** Full range for a tooltip: one date, or "DD/MM/YYYY – DD/MM/YYYY". */
export function chartBucketRangeLabel(bucket: ChartBucket): string {
  const show = (key: string) => {
    const parts = parseDateKey(key)
    return parts ? `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}` : key
  }
  if (bucket.fromKey === bucket.toKey) return show(bucket.fromKey)
  return `${show(bucket.fromKey)} – ${show(bucket.toKey)}`
}
