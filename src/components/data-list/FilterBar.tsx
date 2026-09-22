import { useMemo, useState } from 'react'
import { ChevronDown, Filter } from 'lucide-react'
import {
  Badge,
  Button,
  DatePicker,
  Field,
  Input,
  Select,
  cn,
  type FieldControlProps,
} from '@/components/ui'
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/AsyncSearchSelect'
import { useI18n } from '@/i18n/I18nContext'
import { createClientId } from '@/lib/clientId'
import { useListLabel, useOptionLabel } from './labels'
import type { FilterField, FilterOperator, ListFilter } from './types'

/** Radix reserves '' for "no value", so "any value" needs a sentinel. */
const ANY_VALUE = '__any__'

/**
 * A relational field rendered with `AsyncSearchSelect` instead of a plain
 * select: the bar only needs to know how to search it. The picked option is
 * remembered locally so the trigger keeps showing its label.
 */
export interface FilterBarAsyncField {
  loadOptions: (query: string) => Promise<AsyncSearchSelectOption[]>
  placeholder?: string
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
 * operators: one control per field, the obvious comparison for its type. The
 * full operator list stays available in the filter builder.
 */
export function filterBarOperator(field: FilterField): FilterOperator {
  if (field.type === 'date') return pickOperator(field, ['between', 'eq'])
  if (field.type === 'text' || field.type === 'number')
    return pickOperator(field, ['like', 'eq'])
  return pickOperator(field, ['eq', 'in'])
}

/**
 * Compact filter row for the shared list system.
 *
 * It replaces the field/operator/value "filter builder" rows with one labelled
 * control per allowlisted field: a select for option fields, date pickers for
 * a date range, a text box for free text, and `AsyncSearchSelect` for a
 * relational field. It emits exactly the `ListFilter[]` the list system
 * already consumes (`applyListFilters` turns a date field into `between`), so
 * a screen can swap the builder for this bar without touching its queries.
 *
 * Layout: a 2–4 column grid from `sm` up; below `md` everything collapses
 * behind a "Filters (n)" disclosure so a phone list is not buried under
 * controls. Labels truncate with `truncate-safe` and keep a `title`.
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
  const [expanded, setExpanded] = useState(false)
  const [picked, setPicked] = useState<
    Record<string, AsyncSearchSelectOption | null>
  >({})

  const activeCount = useMemo(
    () =>
      filters.filter(
        (filter) =>
          filter.value ||
          filter.operator === 'is_set' ||
          filter.operator === 'is_not_set',
      ).length,
    [filters],
  )

  const current = (key: string) => filters.find((item) => item.field === key)

  const apply = (field: FilterField, value: string, valueTo?: string): void => {
    const rest = filters.filter((item) => item.field !== field.key)
    if (!value && !valueTo) {
      onChange(rest)
      return
    }
    const existing = current(field.key)
    onChange([
      ...rest,
      {
        id: existing?.id ?? createClientId(),
        field: field.key,
        operator: filterBarOperator(field),
        value,
        valueTo,
      },
    ])
  }

  const clearAll = () => onChange([])

  const control = (field: FilterField, wiring: FieldControlProps) => {
    const filter = current(field.key)
    const value = filter?.value ?? ''
    const asyncField = asyncFields?.[field.key]

    if (asyncField)
      return (
        <AsyncSearchSelect
          {...wiring}
          value={value}
          selectedOption={picked[field.key] ?? null}
          loadOptions={asyncField.loadOptions}
          placeholder={asyncField.placeholder ?? t('all')}
          onChange={(next, option) => {
            setPicked((state) => ({ ...state, [field.key]: option }))
            apply(field, next)
          }}
        />
      )

    if (field.options?.length)
      return (
        <Select
          {...wiring}
          value={value || ANY_VALUE}
          onValueChange={(next) => apply(field, next === ANY_VALUE ? '' : next)}
          options={[
            { value: ANY_VALUE, label: t('all') },
            ...field.options.map((option) => ({
              value: option.value,
              label: optionLabel(option),
            })),
          ]}
        />
      )

    if (field.type === 'date')
      return (
        <div className="flex items-center gap-2">
          <DatePicker
            {...wiring}
            aria-label={t('from')}
            value={value}
            max={filter?.valueTo || undefined}
            onChange={(next) => apply(field, next, filter?.valueTo)}
            className="min-w-0 flex-1"
          />
          <span aria-hidden="true" className="text-sm text-muted">
            –
          </span>
          <DatePicker
            aria-label={t('to')}
            value={filter?.valueTo ?? ''}
            min={value || undefined}
            onChange={(next) => apply(field, value, next)}
            className="min-w-0 flex-1"
          />
        </div>
      )

    return (
      <Input
        {...wiring}
        type={field.type === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(event) => apply(field, event.target.value)}
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
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2 md:hidden">
        <Button
          variant="outline"
          icon={<Filter size={15} aria-hidden="true" />}
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {t('filters')}
          {activeCount > 0 && (
            <Badge tone="neutral" size="sm">
              {activeCount}
            </Badge>
          )}
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={cn('transition-transform', expanded && 'rotate-180')}
          />
        </Button>
        {activeCount > 0 && (
          <Button variant="ghost" onClick={clearAll}>
            {t('clearAll')}
          </Button>
        )}
      </div>

      <div
        className={cn(
          'gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4',
          expanded ? 'grid' : 'hidden md:grid',
        )}
      >
        {fields.map((field) => {
          const label = fieldLabel(field.label)
          return (
            <Field
              key={field.key}
              className={cn(field.type === 'date' && 'sm:col-span-2')}
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

      <div className="hidden items-center gap-3 md:flex">
        <span className="text-xs text-muted">
          {t('filters')}
          {activeCount > 0 ? ` (${activeCount})` : ''}
        </span>
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            {t('clearAll')}
          </Button>
        )}
      </div>
    </div>
  )
}
