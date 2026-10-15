import type { DataListConfig, FilterField, ListFilter } from './types'

/**
 * wave-13-drivers: the URL <-> filter list mapping of the shared list system,
 * kept free of React so it can be tested on its own.
 *
 * A list may declare `defaultFilters` (the drivers list hides the external
 * supplier's drivers by default). The rule that makes such a default visible,
 * restorable and removable:
 *   * no `filters` parameter in the URL (a fresh visit, a sidebar link)
 *     → the config's defaults apply;
 *   * a `filters` parameter → exactly that list, even `[]`. So once the user
 *     removes the default, the URL says so, and neither the next render nor
 *     Back brings it back;
 *   * a list without defaults keeps the old behaviour: an empty list removes
 *     the parameter.
 */

/** The filters a list shows for the raw `filters` URL parameter. */
export function listFiltersFromParam(
  raw: string | null,
  config: Pick<DataListConfig, 'filterFields' | 'defaultFilters'>,
): ListFilter[] {
  const value: unknown =
    raw === null ? (config.defaultFilters ?? []) : parse(raw)
  if (!Array.isArray(value)) return []
  return withoutHiddenFilters(
    value.filter((filter): filter is ListFilter =>
      isAllowedFilter(filter, config.filterFields),
    ),
    config.filterFields,
  )
}

/**
 * Whether a field is offered for the current filters (`FilterField.
 * visibleWhen`): always without a rule; with one, only while the controlling
 * field's filter selects the value, as `eq` that value or `in` a list holding
 * it. A negative filter (`neq`, `not_in`) never satisfies it.
 */
export function isFilterFieldVisible(
  field: Pick<FilterField, 'visibleWhen'>,
  filters: Pick<ListFilter, 'field' | 'operator' | 'value'>[],
): boolean {
  const rule = field.visibleWhen
  if (!rule) return true
  const source = filters.find((filter) => filter.field === rule.field)
  if (!source) return false
  if (source.operator === 'eq') return source.value === rule.includes
  if (source.operator === 'in')
    return source.value
      .split(',')
      .map((entry) => entry.trim())
      .includes(rule.includes)
  return false
}

/**
 * The filters without the ones whose field is not offered any more (its
 * `visibleWhen` condition stopped holding), e.g. the supplier once the owner
 * is no longer «مالك اخر». Repeated until stable, so a chain of dependent
 * fields is dropped as a whole. Filters on fields outside `fields` are kept
 * as they are (the allowlist is checked separately).
 */
export function withoutHiddenFilters<T extends ListFilter>(
  filters: T[],
  fields: Pick<FilterField, 'key' | 'visibleWhen'>[],
): T[] {
  let current = filters
  for (;;) {
    const next = current.filter((filter) => {
      const field = fields.find((item) => item.key === filter.field)
      return !field || isFilterFieldVisible(field, current)
    })
    if (next.length === current.length) return current
    current = next
  }
}

/** The `filters` URL value for a new list; `null` removes the parameter. */
export function listFiltersParam(
  value: ListFilter[],
  config: Pick<DataListConfig, 'defaultFilters'>,
): string | null {
  if (value.length) return JSON.stringify(value)
  // An explicit empty list, so a removed default is not applied again.
  return config.defaultFilters?.length ? '[]' : null
}

/**
 * The `choices` entry an active filter stands for, if any. `FilterBar` shows
 * it as the selected entry instead of the bare value.
 */
export function matchingFilterChoice(
  field: Pick<FilterField, 'choices'>,
  filter: Pick<ListFilter, 'operator' | 'value'> | undefined,
) {
  if (!filter) return null
  return (
    field.choices?.find(
      (choice) =>
        choice.operator === filter.operator && choice.value === filter.value,
    ) ?? null
  )
}

function parse(source: string): unknown {
  try {
    return JSON.parse(source)
  } catch {
    return []
  }
}

/** Same allowlist check the hook always ran: field AND operator allowed. */
function isAllowedFilter(
  filter: unknown,
  fields: FilterField[],
): filter is ListFilter {
  if (!filter || typeof filter !== 'object') return false
  const candidate = filter as Partial<ListFilter>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.value === 'string' &&
    (candidate.valueTo === undefined ||
      typeof candidate.valueTo === 'string') &&
    fields.some(
      (field) =>
        field.key === candidate.field &&
        candidate.operator !== undefined &&
        field.operators.includes(candidate.operator),
    )
  )
}
