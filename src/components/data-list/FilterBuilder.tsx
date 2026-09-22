import { Plus, Trash2 } from 'lucide-react'
import { Select } from '@/components/ui'
import type { FilterField, FilterOperator, ListFilter } from './types'
import { useListLabel, useOptionLabel } from './labels'
import { useI18n } from '@/i18n/I18nContext'
import { createClientId } from '@/lib/clientId'

/** Radix reserves '' for "no value" (see `DriverFormDialog`), so the value
 * select for a filter with predefined options uses a sentinel for "any". */
const ANY_FILTER_VALUE = '__any__'

export function FilterBuilder({
  fields,
  filters,
  onChange,
  compact = false,
}: {
  fields: FilterField[]
  filters: ListFilter[]
  onChange: (filters: ListFilter[]) => void
  compact?: boolean
}) {
  const { t, lang } = useI18n()
  const fieldLabel = useListLabel()
  const optionLabel = useOptionLabel()
  const labels: Record<FilterOperator, string> =
    lang === 'ar'
      ? {
          eq: '=',
          neq: '≠',
          in: 'ضمن',
          not_in: 'ليس ضمن',
          like: 'يحتوي',
          not_like: 'لا يحتوي',
          is_set: 'له قيمة',
          is_not_set: 'بلا قيمة',
          gt: '>',
          lt: '<',
          gte: '≥',
          lte: '≤',
          between: 'بين',
        }
      : {
          eq: '=',
          neq: '≠',
          in: 'In',
          not_in: 'Not in',
          like: 'Contains',
          not_like: 'Does not contain',
          is_set: 'Is set',
          is_not_set: 'Is not set',
          gt: '>',
          lt: '<',
          gte: '≥',
          lte: '≤',
          between: 'Between',
        }
  const add = () => {
    const field = fields[0]
    if (field)
      onChange([
        ...filters,
        {
          id: createClientId(),
          field: field.key,
          operator: field.operators[0],
          value: '',
        },
      ])
  }
  const patch = (id: string, value: Partial<ListFilter>) =>
    onChange(
      filters.map((filter) =>
        filter.id === id ? { ...filter, ...value } : filter,
      ),
    )
  return (
    <div className="space-y-2">
      {filters.map((filter) => {
        const field =
          fields.find((item) => item.key === filter.field) ?? fields[0]
        const noValue =
          filter.operator === 'is_set' || filter.operator === 'is_not_set'
        return (
          <div
            key={filter.id}
            className="grid gap-2 sm:grid-cols-[1fr_140px_1fr_auto]"
          >
            <Select
              className={compact ? '!h-7 !text-xs' : undefined}
              value={filter.field}
              onValueChange={(value) => {
                const next =
                  fields.find((item) => item.key === value) ?? fields[0]
                patch(filter.id, {
                  field: value,
                  operator: next.operators[0],
                  value: '',
                  valueTo: '',
                })
              }}
              options={fields.map((item) => ({
                value: item.key,
                label: fieldLabel(item.label),
              }))}
            />
            <Select
              className={compact ? '!h-7 !text-xs' : undefined}
              value={filter.operator}
              onValueChange={(value) =>
                patch(filter.id, { operator: value as FilterOperator })
              }
              options={field.operators.map((operator) => ({
                value: operator,
                label: labels[operator],
              }))}
            />
            {noValue ? (
              <div />
            ) : field.options ? (
              <Select
                className={compact ? '!h-7 !text-xs' : undefined}
                value={filter.value || ANY_FILTER_VALUE}
                onValueChange={(value) =>
                  patch(filter.id, {
                    value: value === ANY_FILTER_VALUE ? '' : value,
                  })
                }
                options={[
                  { value: ANY_FILTER_VALUE, label: '—' },
                  ...field.options.map((option) => ({
                    value: option.value,
                    label: optionLabel(option),
                  })),
                ]}
              />
            ) : (
              <div className="flex gap-2">
                <input
                  className={`input ${compact ? 'h-8 py-1 text-sm' : ''}`}
                  type={
                    field.type === 'date'
                      ? 'date'
                      : field.type === 'number'
                        ? 'number'
                        : 'text'
                  }
                  value={filter.value}
                  onChange={(event) =>
                    patch(filter.id, { value: event.target.value })
                  }
                />
                {filter.operator === 'between' && (
                  <input
                    className={`input ${compact ? 'h-8 py-1 text-sm' : ''}`}
                    type={field.type === 'date' ? 'date' : 'number'}
                    value={filter.valueTo ?? ''}
                    onChange={(event) =>
                      patch(filter.id, { valueTo: event.target.value })
                    }
                  />
                )}
              </div>
            )}
            <button
              className="btn-ghost p-2"
              onClick={() =>
                onChange(filters.filter((item) => item.id !== filter.id))
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        )
      })}
      <button
        className="btn-outline text-sm"
        onClick={add}
        disabled={!fields.length}
      >
        <Plus size={15} />
        {t('addFilter')}
      </button>
    </div>
  )
}
