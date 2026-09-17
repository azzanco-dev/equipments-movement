import { useI18n } from '@/i18n/I18nContext'
import {
  translations,
  type Language,
  type TranslationKey,
} from '@/i18n/translations'
import { saudiPeriodKeys, type ReportPeriod } from '@/lib/saudiTime'
import { compareDateKeys, isValidDateKey } from '@/lib/calendar'
import { DatePicker } from './DatePicker'
import { Tabs, TabsList, TabsTrigger } from './Tabs'
import { cn } from './cn'

export type DateRangePreset = ReportPeriod | 'custom'

export interface DateRangeValue {
  preset: DateRangePreset
  /** Saudi calendar date keys (YYYY-MM-DD). Always a valid from <= to pair. */
  from: string
  to: string
}

export interface DateRangeFilterProps {
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
  /** Extra bounds applied to the custom range's date pickers. */
  min?: string
  max?: string
  /** Overrides the ambient interface language; see DatePicker's `lang`. */
  lang?: Language
  className?: string
}

const PRESETS: DateRangePreset[] = ['today', 'week', 'month', 'custom']

function isPreset(value: string): value is DateRangePreset {
  return (PRESETS as string[]).includes(value)
}

function tighterMax(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return compareDateKeys(a, b) <= 0 ? a : b
}

function tighterMin(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return compareDateKeys(a, b) >= 0 ? a : b
}

// Resolves labels from the same `lang` used by the date pickers below,
// instead of the ambient i18n context, so an explicit `lang` override (for
// side-by-side locale previews) affects labels and dates together.
function translateFor(lang: Language) {
  return (key: TranslationKey) =>
    translations[lang][key] ?? translations.ar[key] ?? key
}

/**
 * Report period filter: اليوم / هذا الاسبوع / هذا الشهر presets plus a
 * فترة مخصصة (custom) range. Presets always resolve to a valid Saudi-time
 * range; the custom range only calls `onChange` when from <= to.
 */
export function DateRangeFilter({
  value,
  onChange,
  min,
  max,
  lang: langOverride,
  className,
}: DateRangeFilterProps) {
  const { lang: ambientLang } = useI18n()
  const lang = langOverride ?? ambientLang
  const t = translateFor(lang)

  const handlePresetChange = (next: string) => {
    if (!isPreset(next) || next === value.preset) return
    if (next === 'custom') {
      // Start the custom range from the dates currently shown, so the data
      // on screen always matches the selected dates.
      onChange({ preset: 'custom', from: value.from, to: value.to })
      return
    }
    const { from, to } = saudiPeriodKeys(next)
    onChange({ preset: next, from, to })
  }

  const setCustomFrom = (from: string) => {
    if (!isValidDateKey(from)) return
    if (isValidDateKey(value.to) && compareDateKeys(from, value.to) > 0) return
    onChange({ preset: 'custom', from, to: value.to })
  }

  const setCustomTo = (to: string) => {
    if (!isValidDateKey(to)) return
    if (isValidDateKey(value.from) && compareDateKeys(value.from, to) > 0)
      return
    onChange({ preset: 'custom', from: value.from, to })
  }

  const fromMax = tighterMax(max, value.to || undefined)
  const toMin = tighterMin(min, value.from || undefined)

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Tabs value={value.preset} onValueChange={handlePresetChange}>
        <TabsList variant="segmented" aria-label={t('reportPeriodLabel')}>
          <TabsTrigger value="today">{t('todayBadge')}</TabsTrigger>
          <TabsTrigger value="week">{t('thisWeek')}</TabsTrigger>
          <TabsTrigger value="month">{t('thisMonth')}</TabsTrigger>
          <TabsTrigger value="custom">{t('customPeriod')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {value.preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker
            aria-label={t('fromDate')}
            value={value.from}
            min={min}
            max={fromMax}
            lang={lang}
            onChange={setCustomFrom}
            className="w-40"
          />
          <span aria-hidden="true" className="text-sm text-muted">
            –
          </span>
          <DatePicker
            aria-label={t('toDate')}
            value={value.to}
            min={toMin}
            max={max}
            lang={lang}
            onChange={setCustomTo}
            className="w-40"
          />
        </div>
      )}
    </div>
  )
}
