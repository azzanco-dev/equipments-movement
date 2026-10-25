import { useEffect, useRef } from 'react'

/** Two returns closer than this (a tab switch fires both events) load once. */
const RETURN_GAP_MS = 2000

/**
 * Reloads a list when the user comes back to its page: the tab becomes
 * visible again or the window regains focus (owner 2026-10-25, «لازم اسوي
 * تحديث للصفحة بعد كل اضافة PO»: a PO added in another tab left the list
 * stale). The rows stay on screen while the reload runs.
 */
export function useRefetchOnReturn(refetch: () => void) {
  const latest = useRef(refetch)
  latest.current = refetch
  useEffect(() => {
    let last = 0
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - last < RETURN_GAP_MS) return
      last = now
      latest.current()
    }
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [])
}
