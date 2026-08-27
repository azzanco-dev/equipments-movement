import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { DataListConfig, ListFilter } from './types'

const validSizes = new Set([20, 50, 100, 200, 350, 500])

export function useDataListState(config: DataListConfig, prefix = '') {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const key = useCallback((name: string) => `${prefix}${name}`, [prefix])
  const [searchInput, setSearchInput] = useState(params.get(key('q')) ?? '')
  const search = params.get(key('q')) ?? ''
  const page = Math.max(1, Number(params.get(key('page'))) || 1)
  const requestedSize = Number(params.get(key('size'))) || 20
  const pageSize = validSizes.has(requestedSize) ? requestedSize : 20
  const requestedSort = params.get(key('sort')) ?? config.defaultSort
  const sort = config.sortableFields.some(
    (field) => field.key === requestedSort,
  )
    ? requestedSort
    : config.defaultSort
  const direction =
    params.get(key('dir')) === 'desc'
      ? 'desc'
      : params.get(key('dir')) === 'asc'
        ? 'asc'
        : (config.defaultDirection ?? 'asc')
  const filters = useMemo<ListFilter[]>(() => {
    try {
      const value = JSON.parse(
        params.get(key('filters')) ?? '[]',
      ) as ListFilter[]
      return value.filter((filter) =>
        config.filterFields.some(
          (field) =>
            field.key === filter.field &&
            field.operators.includes(filter.operator),
        ),
      )
    } catch {
      return []
    }
  }, [params, config.filterFields, key])

  const update = useCallback(
    (values: Record<string, string | number | null>) => {
      const next = new URLSearchParams(params.toString())
      Object.entries(values).forEach(([key, value]) =>
        value === null || value === ''
          ? next.delete(key)
          : next.set(key, String(value)),
      )
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchInput !== search)
        update({ [key('q')]: searchInput.trim(), [key('page')]: 1 })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput, search, update, key])

  return {
    searchInput,
    setSearchInput,
    search,
    page,
    pageSize,
    sort,
    direction,
    filters,
    setPage: (value: number) => update({ [key('page')]: Math.max(1, value) }),
    setPageSize: (value: number) =>
      update({ [key('size')]: value, [key('page')]: 1 }),
    setSort: (field: string, dir: 'asc' | 'desc') =>
      update({ [key('sort')]: field, [key('dir')]: dir, [key('page')]: 1 }),
    setFilters: (value: ListFilter[]) =>
      update({
        [key('filters')]: value.length ? JSON.stringify(value) : null,
        [key('page')]: 1,
      }),
    clear: () => {
      setSearchInput('')
      router.replace(pathname, { scroll: false })
    },
  }
}
