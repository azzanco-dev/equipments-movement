import {
  PRIMARY_ACTIVE_TRIGGER,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import {
  currentSaudiMonthKey,
  monthKeysBetween,
  monthLabel,
  shiftMonth,
  type MonthKey,
} from '@/lib/sales'
import {
  MONTH_PRESETS,
  MONTH_PRESET_BACK,
  monthPresetLabel,
} from '@/lib/saudiTime'

/** The three month presets of the list filters (owner 2026-10-31), oldest
 *  first, as month keys of the current Saudi month. */
export function presetMonthKeys(
  currentMonth: MonthKey = currentSaudiMonthKey(),
): MonthKey[] {
  return MONTH_PRESETS.map((preset) =>
    shiftMonth(currentMonth, -MONTH_PRESET_BACK[preset]),
  )
}

/** The months before the presets, newest first, back to the earliest card
 *  month (none while the cards start inside the presets). */
export function olderMonthKeys(
  earliestMonth: MonthKey | null,
  currentMonth: MonthKey = currentSaudiMonthKey(),
): MonthKey[] {
  const oldestPreset = presetMonthKeys(currentMonth)[0]
  if (!earliestMonth || earliestMonth >= oldestPreset) return []
  return monthKeysBetween(earliestMonth, shiftMonth(oldestPreset, -1)).reverse()
}

/**
 * The month of the batch screen (the approved mockup): the three presets
 * («Sep (9) · Oct (10) · Nov (11)», the selected one a primary button) and,
 * when cards reach further back, «شهر اقدم» with a select of the older
 * months down to the earliest card month.
 */
export function CardMonthPicker({
  value,
  onChange,
  earliestMonth,
  today,
}: {
  value: MonthKey
  onChange: (month: MonthKey) => void
  /** The earliest card month (null while unknown: no older months). */
  earliestMonth: MonthKey | null
  /** The Saudi day the presets count from (today by default). */
  today?: string
}) {
  const { t, lang } = useI18n()
  const currentMonth = currentSaudiMonthKey(today)
  const presets = presetMonthKeys(currentMonth)
  const older = olderMonthKeys(earliestMonth, currentMonth)
  const tab = presets.includes(value) ? value : 'older'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs
        value={tab}
        onValueChange={(next) =>
          onChange(next === 'older' ? (older[0] ?? value) : next)
        }
      >
        <TabsList variant="segmented" aria-label={t('cardMonthsMonth')}>
          {presets.map((month, index) => (
            <TabsTrigger
              key={month}
              value={month}
              className={PRIMARY_ACTIVE_TRIGGER}
            >
              <bdi dir="ltr">
                {monthPresetLabel(
                  MONTH_PRESET_BACK[MONTH_PRESETS[index]],
                  today,
                )}
              </bdi>
            </TabsTrigger>
          ))}
          {(older.length > 0 || tab === 'older') && (
            <TabsTrigger value="older" className={PRIMARY_ACTIVE_TRIGGER}>
              {t('cardMonthOlder')}
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>
      {tab === 'older' && (
        <Select
          aria-label={t('cardMonthOlder')}
          className="w-[170px]"
          value={value}
          onValueChange={onChange}
          options={(older.includes(value) ? older : [value, ...older]).map(
            (month) => ({ value: month, label: monthLabel(month, lang) }),
          )}
        />
      )}
    </div>
  )
}
