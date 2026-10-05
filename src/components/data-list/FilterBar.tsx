import { useEffect, useId, useRef, useState } from 'react'
import {
  DateRangeFilter,
  Field,
  Input,
  MultiSelect,
  Select,
  cn,
  type DateRangePreset,
  type DateRangeValue,
  type FieldControlProps,
} from '@/components/ui'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { useI18n } from '@/i18n/I18nContext'
import { createClientId } from '@/lib/clientId'
import {
  isDateKey,
  saudiDateKey,
  saudiDayEnd,
  saudiDayStart,
  saudiPeriodKeys,
  type ReportPeriod,
} from '@/lib/saudiTime'
import { AsyncMultiSelect } from './AsyncMultiSelect'
import { useListLabel, useOptionLabel } from './labels'
import { matchingFilterChoice } from './listFilterState'
import type { FilterField, FilterOperator, ListFilter } from './types'

/** Radix reserves '' for "no value", so "any value" needs a sentinel. */
const ANY_VALUE = '__any__'

/** Select value of a `FilterChoice`; never a real option value. */
const CHOICE_PREFIX = '__choice__:'

/** Same pause as the list search box before a typed filter reaches the URL. */
const TEXT_DEBOUNCE_MS = 300

/**
 * The small (28 px) size for controls that have no `size` prop. `!` is needed
 * because their own height classes are responsive (`h-10 md:h-9`). Text stays
 * 16 px on phones for real inputs: the global iOS rule in index.css wins.
 */
const SMALL_INPUT = '!h-7 px-2.5 text-xs'
const SMALL_ASYNC_TRIGGER =
  '[&>button]:!h-7 [&>button]:!px-2.5 [&>button]:!text-xs'
const SMALL_DATE_RANGE =
  '[&_[role=tab]]:!h-7 [&_[role=tab]]:!px-2.5 [&_[role=tab]]:!text-xs [&_.select-trigger]:!h-7 [&_.select-trigger]:!text-xs'

/** What a filter holds, without its identity (`id`, `field`). */
export type FilterValue = Pick<ListFilter, 'operator' | 'value' | 'valueTo'>

/**
 * A relational field rendered with a server-side search instead of a plain
 * select: the bar only needs to know how to search it. A single-value field
 * uses `AsyncSearchSelect`; a field with `multiple: true` uses
 * `AsyncMultiSelect`. Picked options are remembered locally so the trigger
 * keeps showing their labels.
 */
export interface FilterBarAsyncField {
  loadOptions: (query: string) => Promise<AsyncSearchSelectOption[]>
  /**
   * Looks up the label of a value the bar did not pick itself: a filter
   * restored from the URL (Back, a shared link, a reload) carries only the id.
   * Without it the trigger would read "All" while the filter is active.
   */
  resolveOption?: (value: string) => Promise<AsyncSearchSelectOption | null>
  /**
   * Batch form of `resolveOption` for a multi-select field: one query for all
   * the ids restored from the URL. When absent, `resolveOption` is called once
   * per id.
   */
  resolveOptions?: (values: string[]) => Promise<AsyncSearchSelectOption[]>
  placeholder?: string
}

/** First allowed operator from `preferred`, else the field's own first one. */
function pickOperator(
  field: FilterField,
  preferred: FilterOperator[],
): FilterOperator {
  return (
    preferred.find((operator) => field.operators.includes(operator)) ??
    field.operators[0]
  )
}

/**
 * The operator a field's control stands for. The bar deliberately hides
 * operators: one control per field, the obvious comparison for its type.
 * A date field's range may also narrow to `gte` / `lte` when only one end is
 * picked; see `dateRangeFilter`.
 */
export function filterBarOperator(field: FilterField): FilterOperator {
  if (field.multiple) return pickOperator(field, ['in', 'eq'])
  if (field.type === 'date') return pickOperator(field, ['between', 'eq'])
  if (field.type === 'text' || field.type === 'number')
    return pickOperator(field, ['like', 'eq'])
  return pickOperator(field, ['eq', 'in'])
}

/** Number of filters that actually narrow the list (for "Filters (n)"). */
export function countActiveFilters(filters: ListFilter[]): number {
  return filters.filter(
    (filter) =>
      filter.value ||
      filter.operator === 'is_set' ||
      filter.operator === 'is_not_set',
  ).length
}

/** The ids of a multi-value (`in`) filter, as stored in the URL. */
export function splitFilterValues(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * The filter a date range stands for. Date filter fields are timestamps, so
 * each end becomes the first / last instant of that Saudi calendar day
 * (report day boundaries are Saudi time): "today .. today" is the whole day,
 * not the single instant at midnight UTC. Both ends → `between`; one end →
 * `gte` / `lte`; nothing (or an operator the field does not allow) → `null`.
 */
export function dateRangeFilter(
  field: FilterField,
  from: string,
  to: string,
): FilterValue | null {
  const allows = (operator: FilterOperator) =>
    field.operators.includes(operator)
  if (from && to && allows('between'))
    return {
      operator: 'between',
      value: saudiDayStart(from),
      valueTo: saudiDayEnd(to),
    }
  if (from && allows('gte'))
    return { operator: 'gte', value: saudiDayStart(from) }
  if (to && allows('lte')) return { operator: 'lte', value: saudiDayEnd(to) }
  return null
}

/** Saudi date key of a stored bound (an ISO instant, or an older date key). */
function boundKey(value: string | undefined): string {
  if (!value) return ''
  if (isDateKey(value)) return value
  return Number.isNaN(Date.parse(value)) ? '' : saudiDateKey(value)
}

/** The from/to date keys a stored date filter shows in the range control. */
export function dateRangeKeys(filter: ListFilter | undefined): {
  from: string
  to: string
} {
  if (!filter?.value) return { from: '', to: '' }
  switch (filter.operator) {
    case 'between':
      return {
        from: boundKey(filter.value),
        to: boundKey(filter.valueTo ?? filter.value),
      }
    case 'eq':
      return { from: boundKey(filter.value), to: boundKey(filter.value) }
    case 'gte':
    case 'gt':
      return { from: boundKey(filter.value), to: '' }
    case 'lte':
    case 'lt':
      return { from: '', to: boundKey(filter.value) }
    default:
      return { from: '', to: '' }
  }
}

const PERIODS: ReportPeriod[] = ['today', 'week', 'month']

/** The preset a from/to pair matches today, else "custom". */
export function inferDatePreset(from: string, to: string): DateRangePreset {
  for (const period of PERIODS) {
    const keys = saudiPeriodKeys(period)
    if (keys.from === from && keys.to === to) return period
  }
  return 'custom'
}

/**
 * One relational filter control. It remembers the option the user picked, and
 * resolves the label once for a value that arrived from the URL instead.
 */
function AsyncFilterControl({
  wiring,
  value,
  asyncField,
  placeholder,
  onPick,
}: {
  wiring: FieldControlProps
  value: string
  asyncField: FilterBarAsyncField
  placeholder: string
  onPick: (value: string) => void
}) {
  const [picked, setPicked] = useState<AsyncSearchSelectOption | null>(null)
  const { resolveOption } = asyncField
  const known = picked?.value === value

  useEffect(() => {
    if (!value || known || !resolveOption) return
    let cancelled = false
    resolveOption(value).then(
      (option) => {
        if (!cancelled && option) setPicked(option)
      },
      // An unresolved label is cosmetic; the filter itself still applies.
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [value, known, resolveOption])

  return (
    <AsyncSearchSelect
      {...wiring}
      className={SMALL_ASYNC_TRIGGER}
      value={value}
      selectedOption={known ? picked : null}
      loadOptions={asyncField.loadOptions}
      placeholder={asyncField.placeholder ?? placeholder}
      onChange={(next, option) => {
        setPicked(option)
        onPick(next)
      }}
    />
  )
}

/**
 * A relational multi-select filter (company, project). Like the single
 * control it remembers picked labels and resolves ids restored from the URL,
 * in one batch when the field offers `resolveOptions`.
 */
function AsyncMultiFilterControl({
  wiring,
  values,
  asyncField,
  onPick,
}: {
  wiring: FieldControlProps
  values: string[]
  asyncField: FilterBarAsyncField
  onPick: (values: string[]) => void
}) {
  const [known, setKnown] = useState<AsyncSearchSelectOption[]>([])
  const { resolveOption, resolveOptions } = asyncField
  const missing = values
    .filter((entry) => !known.some((option) => option.value === entry))
    .join(',')

  useEffect(() => {
    if (!missing) return
    const ids = missing.split(',')
    const lookup = resolveOptions
      ? resolveOptions(ids)
      : resolveOption
        ? Promise.all(ids.map((entry) => resolveOption(entry))).then((list) =>
            list.filter(
              (option): option is AsyncSearchSelectOption => !!option,
            ),
          )
        : null
    if (!lookup) return
    let cancelled = false
    lookup.then(
      (options) => {
        if (!cancelled && options.length)
          setKnown((current) => [...current, ...options])
      },
      // An unresolved label is cosmetic; the filter itself still applies.
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [missing, resolveOption, resolveOptions])

  return (
    <AsyncMultiSelect
      id={wiring.id}
      aria-describedby={wiring['aria-describedby']}
      invalid={wiring.invalid}
      size="sm"
      value={values}
      selectedOptions={known}
      loadOptions={asyncField.loadOptions}
      onValueChange={(next, options) => {
        setKnown((current) => [
          ...current.filter(
            (option) => !options.some((entry) => entry.value === option.value),
          ),
          ...options,
        ])
        onPick(next)
      }}
    />
  )
}

/**
 * A free-text filter. Typing stays local and reaches the list only after a
 * short pause, so every keystroke is not a URL change plus a server query.
 * A value changed from outside (Clear all, Back) replaces the draft, and a
 * draft still waiting when the control unmounts (the dialog closed within the
 * pause) is committed then instead of being lost.
 */
function TextFilterControl({
  wiring,
  type,
  value,
  onCommit,
}: {
  wiring: FieldControlProps
  type: 'text' | 'number'
  value: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const committed = useRef(value)
  const latestDraft = useRef(draft)
  latestDraft.current = draft
  // The latest callback, so a parent re-render does not restart the pause.
  const commit = useRef(onCommit)
  commit.current = onCommit

  useEffect(() => {
    if (value === committed.current) return
    committed.current = value
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (draft === committed.current) return
    const timer = window.setTimeout(() => {
      committed.current = draft
      commit.current(draft)
    }, TEXT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draft])

  useEffect(
    () => () => {
      if (latestDraft.current === committed.current) return
      committed.current = latestDraft.current
      commit.current(latestDraft.current)
    },
    [],
  )

  return (
    <Input
      {...wiring}
      type={type}
      value={draft}
      className={SMALL_INPUT}
      onChange={(event) => setDraft(event.target.value)}
    />
  )
}

/**
 * The movement-time style range: one `DateRangeFilter` (today / this week /
 * this month / custom from–to) instead of two separate date fields. Nothing
 * is highlighted while the field is unfiltered; "custom" opens the two date
 * pickers and either end alone is a valid filter (`gte` / `lte`).
 */
function DateRangeFilterControl({
  label,
  filter,
  onRange,
}: {
  label: string
  filter: ListFilter | undefined
  onRange: (from: string, to: string) => void
}) {
  const { t } = useI18n()
  const labelId = useId()
  const { from, to } = dateRangeKeys(filter)
  const active = !!(from || to)
  // The preset the user last chose. "Custom" over the same dates as "today"
  // must stay "custom", so the tab is not inferred from the dates alone.
  const [chosen, setChosen] = useState<DateRangePreset | null>(null)
  const wasActive = useRef(active)

  useEffect(() => {
    // Cleared from outside (Clear all, Back): forget the chosen preset.
    if (wasActive.current && !active) setChosen(null)
    wasActive.current = active
  }, [active])

  const preset: DateRangePreset | null = active
    ? chosen === 'custom'
      ? 'custom'
      : chosen && inferDatePreset(from, to) === chosen
        ? chosen
        : inferDatePreset(from, to)
    : chosen === 'custom'
      ? 'custom'
      : null

  const value: DateRangeValue = {
    // No tab is highlighted while the field is unfiltered; `DateRangeFilter`
    // passes the preset straight to Radix Tabs, where an unmatched value
    // simply selects nothing.
    preset: (preset ?? '') as DateRangePreset,
    from,
    to,
  }

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="min-w-0 sm:col-span-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span id={labelId} className="label block truncate-safe" title={label}>
          {label}
        </span>
        {(active || preset) && (
          <button
            type="button"
            onClick={() => {
              setChosen(null)
              onRange('', '')
            }}
            className="mb-1 shrink-0 rounded-md px-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('clear')}
          </button>
        )}
      </div>
      <DateRangeFilter
        value={value}
        className={SMALL_DATE_RANGE}
        onChange={(next) => {
          setChosen(next.preset)
          onRange(next.from, next.to)
        }}
      />
    </div>
  )
}

export interface FilterBarProps {
  /** The config's allowlisted filter fields; nothing else can be filtered. */
  fields: FilterField[]
  /** Current filters, owned by the caller (URL state in the list system). */
  filters: ListFilter[]
  onChange: (filters: ListFilter[]) => void
  /** Field key → async relational search, for fields with no static options. */
  asyncFields?: Record<string, FilterBarAsyncField>
  className?: string
}

/**
 * The filter fields of the shared list system: one labelled control per
 * allowlisted field, never a field/operator/value builder.
 *
 * - option field → `Select` (or `MultiSelect` when `multiple`)
 * - relational field (`asyncFields`) → `AsyncSearchSelect`, or
 *   `AsyncMultiSelect` when `multiple` (emits `in` with the ids)
 * - date field → one `DateRangeFilter` (emits `between` / `gte` / `lte`)
 * - text / number → a debounced text box (`like`)
 *
 * Since the 2026-09-29 owner review this is the body of `FilterDialog`, opened
 * from the toolbar's "Filters" button; lists no longer render it inline.
 * Every control is the small (28 px) size. Changes apply immediately: each
 * one is emitted as the complete `ListFilter[]` the list already consumes.
 */
export function FilterBar({
  fields,
  filters,
  onChange,
  asyncFields,
  className,
}: FilterBarProps) {
  const { t } = useI18n()
  const fieldLabel = useListLabel()
  const optionLabel = useOptionLabel()
  // Two changes can land before the parent re-renders (a text draft flushed
  // while the dialog closes, right after a select change); each builds on the
  // previous one instead of on a stale `filters` prop.
  const latest = useRef(filters)
  latest.current = filters

  const current = (key: string) => filters.find((item) => item.field === key)

  const setFilter = (field: FilterField, next: FilterValue | null): void => {
    const base = latest.current
    const rest = base.filter((item) => item.field !== field.key)
    const existing = base.find((item) => item.field === field.key)
    const result = next
      ? [
          ...rest,
          {
            id: existing?.id ?? createClientId(),
            field: field.key,
            ...next,
          },
        ]
      : rest
    latest.current = result
    onChange(result)
  }

  const apply = (field: FilterField, value: string) =>
    setFilter(
      field,
      value ? { operator: filterBarOperator(field), value } : null,
    )

  const applyMany = (field: FilterField, values: string[]) =>
    setFilter(
      field,
      values.length
        ? { operator: filterBarOperator(field), value: values.join(',') }
        : null,
    )

  const control = (field: FilterField, wiring: FieldControlProps) => {
    const filter = current(field.key)
    const value = filter?.value ?? ''
    const asyncField = asyncFields?.[field.key]

    if (asyncField && field.multiple)
      return (
        <AsyncMultiFilterControl
          wiring={wiring}
          values={splitFilterValues(value)}
          asyncField={asyncField}
          onPick={(next) => applyMany(field, next)}
        />
      )

    if (asyncField)
      return (
        <AsyncFilterControl
          wiring={wiring}
          value={value}
          asyncField={asyncField}
          placeholder={t('all')}
          onPick={(next) => apply(field, next)}
        />
      )

    if (field.multiple)
      return (
        <MultiSelect
          id={wiring.id}
          aria-describedby={wiring['aria-describedby']}
          size="sm"
          value={splitFilterValues(value)}
          onValueChange={(next) => applyMany(field, next)}
          options={(field.options ?? []).map((option) => ({
            value: option.value,
            label: optionLabel(option),
          }))}
        />
      )

    if (field.options?.length) {
      // wave-13-drivers: a whole-filter entry ("all except ...") is shown as
      // itself while its filter is active, never as the bare value.
      const choice = matchingFilterChoice(field, filter)
      return (
        <Select
          {...wiring}
          size="sm"
          value={choice ? CHOICE_PREFIX + choice.key : value || ANY_VALUE}
          onValueChange={(next) => {
            const picked = field.choices?.find(
              (entry) => CHOICE_PREFIX + entry.key === next,
            )
            if (picked)
              setFilter(field, {
                operator: picked.operator,
                value: picked.value,
              })
            else apply(field, next === ANY_VALUE ? '' : next)
          }}
          options={[
            { value: ANY_VALUE, label: t('all') },
            ...(field.choices ?? []).map((entry) => ({
              value: CHOICE_PREFIX + entry.key,
              label: fieldLabel(entry.label),
            })),
            ...field.options.map((option) => ({
              value: option.value,
              label: optionLabel(option),
            })),
          ]}
        />
      )
    }

    return (
      <TextFilterControl
        wiring={wiring}
        type={field.type === 'number' ? 'number' : 'text'}
        value={value}
        onCommit={(next) => apply(field, next)}
      />
    )
  }

  if (!fields.length)
    return (
      <p className={cn('text-xs text-muted', className)}>
        {t('filterBarNoFields')}
      </p>
    )

  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
      {fields.map((field) => {
        const label = fieldLabel(field.label)
        if (field.type === 'date')
          return (
            <DateRangeFilterControl
              key={field.key}
              label={label}
              filter={current(field.key)}
              onRange={(from, to) =>
                setFilter(field, dateRangeFilter(field, from, to))
              }
            />
          )
        return (
          <Field
            key={field.key}
            label={
              <span className="block truncate-safe" title={label}>
                {label}
              </span>
            }
          >
            {(props) => control(field, props)}
          </Field>
        )
      })}
    </div>
  )
}
