import { useCallback, useEffect, useState } from 'react'
import {
  DEV_DATA_MODES,
  DEV_DATA_MODE_LABELS,
  parseDevDataMode,
  type DevDataMode,
} from '@/lib/siteUnitsWorstCase'

const STORAGE_KEY = 'dev:data-mode'

/** Dev only (Break UI): the mode lives in `?data=` and, because the list
 *  state rewrites the query, also in sessionStorage so a reload keeps it. */
export const DEV_TOGGLE_ENABLED = process.env.NODE_ENV !== 'production'

export function useDevDataMode(): [DevDataMode, (mode: DevDataMode) => void] {
  const [mode, setMode] = useState<DevDataMode>('demo')

  useEffect(() => {
    if (!DEV_TOGGLE_ENABLED) return
    let stored: string | null = null
    try {
      stored = sessionStorage.getItem(STORAGE_KEY)
    } catch {
      // storage can be blocked
    }
    const fromUrl = new URLSearchParams(window.location.search).get('data')
    setMode(parseDevDataMode(fromUrl ?? stored))
  }, [])

  const change = useCallback((next: DevDataMode) => {
    setMode(next)
    try {
      sessionStorage.setItem(STORAGE_KEY, next)
    } catch {
      // storage can be blocked
    }
    const url = new URL(window.location.href)
    if (next === 'demo') url.searchParams.delete('data')
    else url.searchParams.set('data', next)
    window.history.replaceState(window.history.state, '', url)
  }, [])

  return [DEV_TOGGLE_ENABLED ? mode : 'demo', change]
}

/** Plain chrome, fixed at the bottom centre; never in production. */
export function DevDataToggle({
  mode,
  onChange,
}: {
  mode: DevDataMode
  onChange: (mode: DevDataMode) => void
}) {
  if (!DEV_TOGGLE_ENABLED) return null
  return (
    <div
      dir="ltr"
      role="group"
      aria-label="Dev data mode"
      className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 gap-0.5 rounded-full border bg-surface-hover p-0.5 text-xs shadow-sm"
    >
      {DEV_DATA_MODES.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={mode === item}
          onClick={() => onChange(item)}
          className={`rounded-full px-2.5 py-1 ${
            mode === item ? 'bg-bg font-medium text-fg shadow-sm' : 'text-muted'
          }`}
        >
          {DEV_DATA_MODE_LABELS[item]}
        </button>
      ))}
    </div>
  )
}
