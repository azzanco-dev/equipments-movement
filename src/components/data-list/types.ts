import type { ReactNode } from 'react'

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
export type FilterField = {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'boolean' | 'select'
  operators: FilterOperator[]
  options?: { value: string; label: string }[]
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
  searchPlaceholder: string
  searchFields: string[]
  filterFields: FilterField[]
  sortableFields: { key: string; label: string }[]
  columns?: { key: string; label: string }[]
  pageSizeOptions?: readonly number[]
  defaultSort: string
  defaultDirection?: 'asc' | 'desc'
  bulkActions?: { key: string; label: string; icon?: ReactNode }[]
}
