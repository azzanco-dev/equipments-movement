import type { ReactNode } from 'react'
import type { TranslationKey } from '@/i18n/translations'

export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 350, 500] as const
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'like'
  | 'not_like'
  | 'is_set'
  | 'is_not_set'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'between'

/**
 * A config label that follows the interface language.
 *
 * List configs used to hold plain Arabic strings, so the English UI still
 * showed "وقت الحركة" in the sort menu and the filter builder. A label is now
 * either a key of the shared translation table, or an inline `{ ar, en }` pair
 * for wording that belongs to one list only and does not need a global key.
 * Resolve it with `useListLabel()` / `resolveListLabel()` from `./labels`.
 */
export type ListLabel =
  | TranslationKey
  | { ar: string; en: string }
  // Any other string is used as written. This keeps older configs and any
  // runtime-built label compiling; new labels should be a key or an { ar, en }
  // pair so the English UI stops showing Arabic. `string & {}` keeps the key
  // suggestions above visible in editors instead of widening to `string`.
  | (string & Record<never, never>)

/**
 * A filter value option. `label` stays a plain string so a screen can inject
 * runtime options whose text is data, not copy; static options in
 * `listConfigs` add `labelI18n` so they follow the interface language.
 * Relational fields (the `/logs` foreman) use `FilterBar`'s `asyncFields`
 * instead of injected options.
 */
export type FilterOption = {
  value: string
  label: string
  labelI18n?: ListLabel
}

/**
 * wave-13-drivers: one entry of an option field's select that stands for a
 * whole filter (operator and value), not just a value, e.g. "all except an
 * external supplier" (`neq`). `FilterBar` lists it after "All" and shows it as
 * the selected entry while the matching filter is active, so a negative
 * filter never reads like an "equals" one. The operator must be allowlisted on
 * the field.
 */
export type FilterChoice = {
  key: string
  operator: FilterOperator
  value: string
  label: ListLabel
}

export type FilterField = {
  key: string
  label: ListLabel
  type: 'text' | 'number' | 'date' | 'boolean' | 'select'
  operators: FilterOperator[]
  options?: FilterOption[]
  /** Whole-filter entries of a single-value option select; see `FilterChoice`. */
  choices?: FilterChoice[]
  /**
   * wave-13-drivers: `neq` and `not_in` also keep the rows where the column is
   * NULL (SQL `IS DISTINCT FROM`), instead of PostgREST's plain `<>`, which
   * drops them. Used where an empty value means "not set yet" and must stay
   * visible under "everything except X".
   */
  negationKeepsEmpty?: boolean
  /**
   * Several values at once: the filter dialog renders a multi-select and
   * emits the `in` operator with the ids joined by commas (the field must
   * allow `in`). A relational multi-select gets its search from
   * `asyncFields` (company and project on `/logs`).
   */
  multiple?: boolean
}
export type ListFilter = {
  id: string
  field: string
  operator: FilterOperator
  value: string
  valueTo?: string
}
export type DataListConfig = {
  id: string
  searchPlaceholder: ListLabel
  searchFields: string[]
  filterFields: FilterField[]
  sortableFields: { key: string; label: ListLabel }[]
  columns?: { key: string; label: ListLabel }[]
  pageSizeOptions?: readonly number[]
  defaultSort: string
  defaultDirection?: 'asc' | 'desc'
  /**
   * wave-13-drivers: filters applied while the URL carries no `filters`
   * parameter (a fresh visit). They are ordinary, visible filters: the
   * toolbar counts them and the filter dialog shows and removes them. Once
   * the user changes the filters the URL always holds the explicit list
   * (`[]` when everything was removed), so a cleared default stays cleared
   * on the next render and after Back. See `listFilterState.ts`.
   */
  defaultFilters?: ListFilter[]
  bulkActions?: { key: string; label: string; icon?: ReactNode }[]
}
