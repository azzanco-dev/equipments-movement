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
 * A filter value option. `label` stays a plain string because screens inject
 * runtime options (the foreman list in `/logs`, for example) whose text is
 * data, not copy; static options in `listConfigs` add `labelI18n` so they
 * follow the interface language.
 */
export type FilterOption = {
  value: string
  label: string
  labelI18n?: ListLabel
}

export type FilterField = {
  key: string
  label: ListLabel
  type: 'text' | 'number' | 'date' | 'boolean' | 'select'
  operators: FilterOperator[]
  options?: FilterOption[]
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
  bulkActions?: { key: string; label: string; icon?: ReactNode }[]
}
