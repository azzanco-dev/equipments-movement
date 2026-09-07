import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import type { DataListConfig, ListFilter } from './types'

const validSizes = new Set([20, 50, 100, 200, 350, 500])

export function useDataListState(config: DataListConfig, prefix = '') {
  const pathname = usePathname()
  const params = useSearchParams()
  const key = useCallback((name: string) => `${prefix}${name}`, [prefix])
  const [searchInput, setSearchInput] = useState(params.get(key('q')) ?? '')
  const pendingSearch = useRef(false)
  const search = params.get(key('q')) ?? ''
  const requestedPage = Number(params.get(key('page')))
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
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
  const serializedFilters = params.get(key('filters')) ?? '[]'
  const filters = useMemo<ListFilter[]>(() => {
    try {
      const value = JSON.parse(serializedFilters) as ListFilter[]
      if (!Array.isArray(value)) return []
      return value.filter(
        (filter) =>
          filter &&
          typeof filter.id === 'string' &&
          typeof filter.value === 'string' &&
          (filter.valueTo === undefined ||
            typeof filter.valueTo === 'string') &&
          config.filterFields.some(
            (field) =>
              field.key === filter.field &&
              field.operators.includes(filter.operator),
          ),
      )
    } catch {
      return []
    }
  }, [serializedFilters, config.filterFields])

  const update = useCallback(
    (values: Record<string, string | number | null>) => {
      const next = new URLSearchParams(params.toString())
      Object.entries(values).forEach(([key, value]) =>
        value === null || value === ''
          ? next.delete(key)
          : next.set(key, String(value)),
      )
      const query = next.toString()
      if (query !== params.toString())
        window.history.replaceState(
          null,
          '',
          query ? `${pathname}?${query}` : pathname,
        )
    },
    [params, pathname],
  )

  useEffect(() => {
    pendingSearch.current = false
    setSearchInput(search)
  }, [search, pathname])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (pendingSearch.current && searchInput.trim() !== search) {
        pendingSearch.current = false
        update({ [key('q')]: searchInput.trim(), [key('page')]: 1 })
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput, search, update, key])

  return {
    searchInput,
    setSearchInput: (value: string) => {
      pendingSearch.current = true
      setSearchInput(value)
    },
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
      pendingSearch.current = false
      setSearchInput('')
      update(
        Object.fromEntries(
          ['q', 'page', 'size', 'sort', 'dir', 'filters'].map((name) => [
            key(name),
            null,
          ]),
        ),
      )
    },
  }
}
