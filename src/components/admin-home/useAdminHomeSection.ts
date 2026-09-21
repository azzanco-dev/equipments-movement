import { useCallback, useEffect, useRef, useState } from 'react'

export interface AdminHomeSectionState<T> {
  data: T | null
  loading: boolean
  /** True when the last attempt failed; never conflated with "no data". */
  failed: boolean
  retry: () => void
}

/**
 * Loads one admin-home section independently of the others.
 *
 * Each section owns its own request, so a slow or failing section never blocks
 * the rest of the page, and a failure is remembered as a failure (the section
 * renders `ErrorState` with a retry) rather than collapsing into an empty
 * result.
 *
 * `load` must be memoized by the caller (`useCallback`): it is the dependency
 * that decides when a reload happens, so the owner filter and the period are
 * captured in it and nothing else needs to be passed here. The previous
 * request is aborted whenever it changes, and a late response from an aborted
 * request can never overwrite newer state.
 */
export function useAdminHomeSection<T>(
  load: (signal: AbortSignal) => Promise<T>,
): AdminHomeSectionState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    void (async () => {
      try {
        const result = await load(controller.signal)
        if (controller.signal.aborted || !mounted.current) return
        setData(result)
        setFailed(false)
      } catch {
        if (controller.signal.aborted || !mounted.current) return
        // The data is deliberately left as it was: the section shows the
        // failure, not a silently emptied table.
        setFailed(true)
      } finally {
        if (!controller.signal.aborted && mounted.current) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [load, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  return { data, loading, failed, retry }
}
