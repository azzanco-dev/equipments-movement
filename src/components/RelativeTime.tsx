import { useI18n } from '@/i18n/I18nContext'
import { formatDateTime } from '@/lib/dateFormat'

export function RelativeTime({ value }: { value: string | Date }) {
  const { lang } = useI18n()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime()))
    return <span className="text-xs text-muted">—</span>

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 1000),
  )
  const units =
    lang === 'ar'
      ? { second: 'ث', minute: 'د', hour: 'س', day: 'ي', month: 'ش', year: 'س' }
      : { second: 's', minute: 'm', hour: 'h', day: 'd', month: 'M', year: 'y' }

  let amount: number
  let unit: string
  if (elapsedSeconds < 60) {
    amount = elapsedSeconds
    unit = units.second
  } else if (elapsedSeconds < 3600) {
    amount = Math.floor(elapsedSeconds / 60)
    unit = units.minute
  } else if (elapsedSeconds < 86400) {
    amount = Math.floor(elapsedSeconds / 3600)
    unit = units.hour
  } else if (elapsedSeconds < 2_592_000) {
    amount = Math.floor(elapsedSeconds / 86400)
    unit = units.day
  } else if (elapsedSeconds < 31_536_000) {
    amount = Math.floor(elapsedSeconds / 2_592_000)
    unit = units.month
  } else {
    amount = Math.floor(elapsedSeconds / 31_536_000)
    unit = units.year
  }

  const fullDateTime = formatDateTime(date, false)
  return (
    <time
      dateTime={date.toISOString()}
      title={fullDateTime}
      aria-label={fullDateTime}
      className="whitespace-nowrap text-[11px] text-muted"
    >
      {amount} {unit}
    </time>
  )
}
