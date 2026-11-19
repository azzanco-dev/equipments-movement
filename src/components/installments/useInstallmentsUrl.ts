import { useCallback, useMemo } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  readInstallmentsUrlState,
  type InstallmentsUrlState,
} from '@/lib/installmentsView'

/**
 * The page-level state of «الاقساط» in its URL — the open tab and the dues
 * sub-tab — so Back restores it. The contracts and the dues lists keep their
 * own search / filters / sort / page / size through `useDataListState`
 * (prefixes `c` and `d`). Written with `history.replaceState` like the
 * unified lists: a change of the query never adds a history entry.
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

  return { state, update }
}
