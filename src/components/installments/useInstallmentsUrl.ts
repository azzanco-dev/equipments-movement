import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  readInstallmentsUrlState,
  INSTALLMENTS_URL_KEYS,
  type InstallmentsUrlState,
} from '@/lib/installmentsView'

/** A typed search waits this long before it reaches the URL (and the
 *  server), like every list. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * The state the «الاقساط» page keeps in its URL — the tab, the contracts'
 * search / filters / sort / page, the dues' sub-tab / financier / page — so
 * Back restores it. Written with `history.replaceState` like the unified
 * lists (`useDataListState`): a change of the query never adds a history
 * entry.
 */
export function useInstallmentsUrl() {
  const pathname = usePathname()
  const params = useSearchParams()
  const state: InstallmentsUrlState = useMemo(
    () => readInstallmentsUrlState((name) => params.get(name)),
    [params],
  )

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

  // The search box keeps what is typed; the URL holds the trimmed term.
  const [searchInput, setSearchInputState] = useState(state.search)
  const pendingSearch = useRef(false)
  useEffect(() => {
    pendingSearch.current = false
    setSearchInputState((current) =>
      current.trim() === state.search ? current : state.search,
    )
  }, [state.search])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (pendingSearch.current && searchInput.trim() !== state.search) {
        pendingSearch.current = false
        update({
          [INSTALLMENTS_URL_KEYS.search]: searchInput.trim(),
          [INSTALLMENTS_URL_KEYS.page]: null,
        })
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchInput, state.search, update])

  const setSearchInput = useCallback((value: string) => {
    pendingSearch.current = true
    setSearchInputState(value)
  }, [])

  return { state, update, searchInput, setSearchInput }
}
