import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/** Reads the search term (`q`) and the page (`page`) of a list from its URL:
 *  a missing, non-numeric or non-positive page is page 1. */
export function searchPageFromParams(params: {
  get(name: string): string | null
}): { search: string; page: number } {
  const requestedPage = Number(params.get('page'))
  return {
    search: params.get('q') ?? '',
    page:
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1,
  }
}

/** The next query string after writing `values` (null or '' removes a key). */
export function searchPageQuery(
  current: string,
  values: Record<string, string | number | null>,
): string {
  const next = new URLSearchParams(current)
  Object.entries(values).forEach(([key, value]) =>
    value === null || value === ''
      ? next.delete(key)
      : next.set(key, String(value)),
  )
  return next.toString()
}

/**
 * Search box and page of a small list that is not a `DataList` (the Settings
 * lists of equipment types and banks), kept in the URL as `q` and `page` the
 * way `useDataListState` keeps them, so Back and reload restore them: the
 * values are read from the URL, written with `replaceState` (never a push),
 * the term ~300 ms after typing stops, trimmed, with the page back to 1. The
 * box keeps what the user typed while it trims to the term in the URL.
 *
 * `enabled` false (a sibling section of the same screen is shown) reads the
 * defaults and never writes, so the hook leaves another section's URL alone.
 */
export function useUrlSearchPage(enabled = true) {
  const pathname = usePathname()
  const params = useSearchParams()
  const fromUrl = enabled
    ? searchPageFromParams(params)
    : { search: '', page: 1 }
  const { search, page } = fromUrl
  const [searchInput, setSearchInput] = useState(search)
  const pendingSearch = useRef(false)

  const update = useCallback(
    (values: Record<string, string | number | null>) => {
      if (!enabled) return
      const current = params.toString()
      const query = searchPageQuery(current, values)
      if (query !== current)
        window.history.replaceState(
          null,
          '',
          query ? `${pathname}?${query}` : pathname,
        )
    },
    [enabled, params, pathname],
  )

  useEffect(() => {
    pendingSearch.current = false
    setSearchInput((current) => (current.trim() === search ? current : search))
  }, [search, pathname])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (pendingSearch.current && searchInput.trim() !== search) {
        pendingSearch.current = false
        update({ q: searchInput.trim(), page: 1 })
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput, search, update])

  return {
    /** What the box shows. */
    searchInput,
    setSearchInput: (value: string) => {
      pendingSearch.current = true
      setSearchInput(value)
    },
    /** The trimmed term in the URL, for the query. */
    search,
    page,
    setPage: (value: number) => update({ page: Math.max(1, value) }),
  }
}
