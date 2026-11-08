import { useI18n } from '@/i18n/I18nContext'
import {
  translations,
  type Language,
  type TranslationKey,
} from '@/i18n/translations'
import {
  MONTH_PRESETS,
  MONTH_PRESET_BACK,
  monthPresetLabel,
  saudiDateKey,
  saudiMonthKeys,
  type MonthPreset,
} from '@/lib/saudiTime'
import { compareDateKeys, nextCustomRange } from '@/lib/calendar'
import { DatePicker } from './DatePicker'
import { PRIMARY_ACTIVE_TRIGGER, Tabs, TabsList, TabsTrigger } from './Tabs'
import { cn } from './cn'

export type DateRangePreset = MonthPreset | 'custom'

export interface DateRangeValue {
  preset: DateRangePreset
  /**
   * Saudi calendar date keys (YYYY-MM-DD). A month preset is always a valid
   * from <= to pair; in the custom preset either end may be '' (cleared with
   * the date picker's X: an open-ended range, or no range at all when both
   * are empty), and two set ends always keep from <= to.
   */
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

const PRESETS: DateRangePreset[] = [...MONTH_PRESETS, 'custom']

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
 * Period filter: three whole-month presets — the month before last, the
 * previous month and this month (1st → today), oldest first (owner
 * 2026-10-31) — plus a فترة مخصصة (custom) range. A month tab reads as the English month and its number,
 * "Oct (10)", in both UI languages. Presets always resolve to a valid
 * Saudi-time range; the custom range calls `onChange` when an end is cleared
 * (an empty key) or when a picked date keeps from <= to (`nextCustomRange`).
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
  const today = saudiDateKey()

  const handlePresetChange = (next: string) => {
    if (!isPreset(next) || next === value.preset) return
    if (next === 'custom') {
      // Start the custom range from the dates currently shown, so the data
      // on screen always matches the selected dates.
      onChange({ preset: 'custom', from: value.from, to: value.to })
      return
    }
    const { from, to } = saudiMonthKeys(MONTH_PRESET_BACK[next], today)
    onChange({ preset: next, from, to })
  }

  const setCustomEnd = (end: 'from' | 'to', key: string) => {
    const next = nextCustomRange(value, end, key)
    if (next) onChange({ preset: 'custom', ...next })
  }

  const fromMax = tighterMax(max, value.to || undefined)
  const toMin = tighterMin(min, value.from || undefined)

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Tabs value={value.preset} onValueChange={handlePresetChange}>
        <TabsList variant="segmented" aria-label={t('reportPeriodLabel')}>
          {MONTH_PRESETS.map((preset) => (
            <TabsTrigger
              key={preset}
              value={preset}
              className={PRIMARY_ACTIVE_TRIGGER}
            >
              <bdi dir="ltr">
                {monthPresetLabel(MONTH_PRESET_BACK[preset], today)}
              </bdi>
            </TabsTrigger>
          ))}
          <TabsTrigger value="custom" className={PRIMARY_ACTIVE_TRIGGER}>
            {t('customPeriod')}
          </TabsTrigger>
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
            onChange={(key) => setCustomEnd('from', key)}
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
            onChange={(key) => setCustomEnd('to', key)}
            className="w-40"
          />
        </div>
      )}
    </div>
  )
}
