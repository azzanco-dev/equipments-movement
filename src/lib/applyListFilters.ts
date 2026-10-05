import type { ListFilter } from '@/components/data-list/types'

/**
 * The option value that stands for "no value" (SQL NULL) in a multi-select
 * filter, e.g. drivers with no employment type. `applyListFilters` turns an
 * `in` list holding it into `or=(field.is.null,field.in.(...))`, so the
 * rows with an empty column can be ticked like any other option. No stored
 * value can equal it.
 */
export const EMPTY_FILTER_VALUE = '__empty__'

type QueryLike = {
  eq: (column: string, value: unknown) => QueryLike
  neq: (column: string, value: unknown) => QueryLike
  in: (column: string, values: string[]) => QueryLike
  not: (column: string, operator: string, value: unknown) => QueryLike
  ilike: (column: string, pattern: string) => QueryLike
  is: (column: string, value: null | boolean) => QueryLike
  gt: (column: string, value: string) => QueryLike
  lt: (column: string, value: string) => QueryLike
  gte: (column: string, value: string) => QueryLike
  lte: (column: string, value: string) => QueryLike
  or: (filters: string) => QueryLike
}

/**
 * A value inside a PostgREST logic tree (`or=(...)`), always double-quoted so
 * a space, comma, period or parenthesis in it cannot change the expression.
 */
export function logicTreeValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Applies the allowlisted list filters to a PostgREST query.
 *
 * `keepEmptyOnNegation` (wave-13-drivers) names the fields whose `neq` /
 * `not_in` must also keep NULL rows (see `FilterField.negationKeepsEmpty`):
 * they become `or=(field.is.null,field.neq."value")`. Several `or` parameters
 * on one request are combined with AND by PostgREST, so this composes with
 * the list's search `or`.
 */
export function applyListFilters<T>(
  source: T,
  filters: ListFilter[],
  allowedFields: Set<string>,
  keepEmptyOnNegation: ReadonlySet<string> = new Set(),
): T {
  let query = source as unknown as QueryLike
  for (const filter of filters) {
    if (!allowedFields.has(filter.field)) continue
    const keepEmpty = keepEmptyOnNegation.has(filter.field)
    const values = filter.value
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    if (!filter.value && !['is_set', 'is_not_set'].includes(filter.operator))
      continue
    switch (filter.operator) {
      case 'eq':
        query = query.eq(filter.field, filter.value)
        break
      case 'neq':
        query = keepEmpty
          ? query.or(
              `${filter.field}.is.null,${filter.field}.neq.${logicTreeValue(filter.value)}`,
            )
          : query.neq(filter.field, filter.value)
        break
      case 'in': {
        // The "no value" option of a multi-select: NULL rows are matched
        // together with the ticked values.
        const listed = values.filter((value) => value !== EMPTY_FILTER_VALUE)
        if (listed.length === values.length)
          query = query.in(filter.field, values)
        else if (!listed.length) query = query.is(filter.field, null)
        else
          query = query.or(
            `${filter.field}.is.null,${filter.field}.in.(${listed.map(logicTreeValue).join(',')})`,
          )
        break
      }
      case 'not_in':
        query = keepEmpty
          ? query.or(
              `${filter.field}.is.null,${filter.field}.not.in.(${values.map(logicTreeValue).join(',')})`,
            )
          : query.not(filter.field, 'in', `(${values.join(',')})`)
        break
      case 'like':
        query = query.ilike(filter.field, `%${filter.value}%`)
        break
      case 'not_like':
        query = query.not(filter.field, 'ilike', `%${filter.value}%`)
        break
      case 'is_set':
        query = query.not(filter.field, 'is', null)
        break
      case 'is_not_set':
        query = query.is(filter.field, null)
        break
      case 'gt':
        query = query.gt(filter.field, filter.value)
        break
      case 'lt':
        query = query.lt(filter.field, filter.value)
        break
      case 'gte':
        query = query.gte(filter.field, filter.value)
        break
      case 'lte':
        query = query.lte(filter.field, filter.value)
        break
      case 'between':
        query = query
          .gte(filter.field, filter.value)
          .lte(filter.field, filter.valueTo ?? filter.value)
        break
    }
  }
  return query as unknown as T
}
