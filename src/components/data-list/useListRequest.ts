import { useCallback, useEffect, useRef } from 'react'

// A newer list request owns the result; obsolete requests stop consuming bandwidth.
export function useListRequest() {
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  return useCallback(() => {
    controller.current?.abort()
    controller.current = new AbortController()
    return controller.current.signal
  }, [])
}
