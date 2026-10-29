/**
 * The admin home's greeting and date line (owner 2026-10-29, approved on the
 * /ui-kit «نموذج الرئيسية الجديدة»: «حلو التاريخ والتصبيحة، اعتمدها في
 * الرئيسية»). Both follow Saudi time (UTC+03:00), like every day boundary of
 * the dashboards, whatever the browser's time zone.
 */

const SAUDI_TIME_ZONE = 'Asia/Riyadh'

/** Morning until noon, Saudi time; evening from noon. */
export function saudiGreetingPeriod(now: Date): 'morning' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: SAUDI_TIME_ZONE,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  )
  return hour < 12 ? 'morning' : 'evening'
}

/**
 * «الخميس 29 اكتوبر» / «Thursday 29 October»: the Saudi day in the
 * Gregorian calendar with Latin digits, no comma, and the Arabic month
 * without hamza forms (the project's rule for new Arabic copy).
 */
export function saudiDayLabel(now: Date, lang: 'ar' | 'en'): string {
  const parts = new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', {
    timeZone: SAUDI_TIME_ZONE,
    calendar: 'gregory',
    numberingSystem: 'latn',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''
  const label = `${part('weekday')} ${part('day')} ${part('month')}`
  return lang === 'ar' ? label.replace(/[أإآ]/g, 'ا') : label
}
