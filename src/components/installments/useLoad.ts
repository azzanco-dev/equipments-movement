import { useCallback, useEffect, useState } from 'react'

export type LoadStatus = 'loading' | 'failed' | 'ready'

export interface LoadState<T> {
  status: LoadStatus
  /** The loaded data; while a reload runs, the data of before (a list does
   *  not blink); null after a failure and before the first answer. */
  data: T | null
  /** Runs the loader again (the retry of an error state). */
  reload: () => void
}

/**
 * One read of a screen: `loader` runs on mount, whenever it or `version`
 * changes, and on `reload()`; an obsolete run is aborted and ignored. The
 * loader THROWS on failure (`src/lib/installmentsData.ts`), so a failed
 * read is `failed` — an error state with a retry — never an empty list.
 * Pass a `loader` made with `useCallback`.
 */
export function useLoad<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  version = 0,
): LoadState<T> {
  const [state, setState] = useState<{ status: LoadStatus; data: T | null }>({
    status: 'loading',
    data: null,
  })
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState((current) => ({ status: 'loading', data: current.data }))
    loader(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data })
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({ status: 'failed', data: null })
      })
    return () => controller.abort()
  }, [loader, version, retry])

  const reload = useCallback(() => setRetry((key) => key + 1), [])
  return { ...state, reload }
}
