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
  return value.filter((filter): filter is ListFilter =>
    isAllowedFilter(filter, config.filterFields),
  )
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
