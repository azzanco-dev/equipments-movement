// How long ago, in full words (owner 2026-10-26, the Afaqy tables: «خلي
// اخر اشارة بكامل النص، مثل 7 شهور، سنتين»): «دقيقة», «ساعتين», «5 ايام»,
// «7 شهور», «سنتين», «12 سنة»; «3 months», «2 years». Pure.

type Unit = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year'

/** Arabic: one, two, three to ten, eleven and more. */
const AR: Record<Unit, [string, string, string, string]> = {
  second: ['ثانية', 'ثانيتين', 'ثواني', 'ثانية'],
  minute: ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة'],
  hour: ['ساعة', 'ساعتين', 'ساعات', 'ساعة'],
  day: ['يوم', 'يومين', 'ايام', 'يوم'],
  month: ['شهر', 'شهرين', 'شهور', 'شهر'],
  year: ['سنة', 'سنتين', 'سنوات', 'سنة'],
}

const EN: Record<Unit, [string, string]> = {
  second: ['second', 'seconds'],
  minute: ['minute', 'minutes'],
  hour: ['hour', 'hours'],
  day: ['day', 'days'],
  month: ['month', 'months'],
  year: ['year', 'years'],
}

function largestUnit(seconds: number): { amount: number; unit: Unit } {
  if (seconds < 60) return { amount: Math.max(1, seconds), unit: 'second' }
  if (seconds < 3600)
    return { amount: Math.floor(seconds / 60), unit: 'minute' }
  if (seconds < 86_400)
    return { amount: Math.floor(seconds / 3600), unit: 'hour' }
  if (seconds < 2_592_000)
    return { amount: Math.floor(seconds / 86_400), unit: 'day' }
  if (seconds < 31_536_000)
    return { amount: Math.floor(seconds / 2_592_000), unit: 'month' }
  return { amount: Math.floor(seconds / 31_536_000), unit: 'year' }
}

/** The time since `value` in full words, in the largest whole unit. */
export function elapsedInWords(
  value: string | Date,
  lang: 'ar' | 'en',
  nowMs: number = Date.now(),
): string | null {
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isFinite(time)) return null
  const seconds = Math.max(0, Math.floor((nowMs - time) / 1000))
  const { amount, unit } = largestUnit(seconds)
  if (lang === 'en') {
    const [one, many] = EN[unit]
    return `${amount} ${amount === 1 ? one : many}`
  }
  const [one, two, few, many] = AR[unit]
  if (amount === 1) return one
  if (amount === 2) return two
  if (amount <= 10) return `${amount} ${few}`
  return `${amount} ${many}`
}
