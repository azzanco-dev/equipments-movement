'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import type { EntriesLineChartProps } from './EntriesLineChart'
import type { FleetDonutProps } from './FleetDonut'

/**
 * The only entry point to the Recharts-backed charts.
 *
 * Recharts is approved for the admin home only, so every component that
 * imports it lives under `src/components/charts/` and is reached through the
 * lazy wrappers below. Nothing else imports `recharts` directly, and the
 * `@/components/charts` barrel stays free of it, so the rest of the
 * application never pays for the library.
 *
 * The wrappers are hand-rolled rather than `next/dynamic` so a section can
 * start the download when it mounts and ask whether the chart is ready
 * (`use...Ready`). A section then keeps its own single skeleton until both its
 * data and the chart code have arrived, instead of showing its skeleton, then
 * the chart's, then the chart. Once the chunk is loaded the chart renders
 * synchronously, with no fallback frame in between. Like `ssr: false` before
 * it, nothing here renders a chart on the server: the import only starts in an
 * effect.
 */

const chartLoading = () => <Skeleton className="h-64 w-full" />

interface LazyChart<Props extends object> {
  /** Renders the chart, or the chart skeleton until its code has arrived. */
  Chart: ComponentType<Props>
  /** Starts the download on mount; true once the chart can render. */
  useReady: () => boolean
}

function lazyChart<Props extends object>(
  load: () => Promise<ComponentType<Props>>,
): LazyChart<Props> {
  let Loaded: ComponentType<Props> | null = null
  let pending: Promise<void> | null = null

  const preload = () => {
    pending ??= load().then(
      (component) => {
        Loaded = component
      },
      (error: unknown) => {
        // Let a later mount try again rather than caching the failure.
        pending = null
        throw error
      },
    )
    return pending
  }

  function useReady() {
    const [ready, setReady] = useState(Loaded !== null)
    const [error, setError] = useState<unknown>(null)
    useEffect(() => {
      if (Loaded) {
        setReady(true)
        return
      }
      let active = true
      preload().then(
        () => {
          if (active) setReady(true)
        },
        (reason: unknown) => {
          if (active) setError(reason ?? new Error('chart load failed'))
        },
      )
      return () => {
        active = false
      }
    }, [])
    // A chunk that cannot be loaded is a failure, not an endless skeleton:
    // rethrow it to the nearest error boundary, as `next/dynamic` did.
    if (error) throw error
    return ready
  }

  function Chart(props: Props) {
    const ready = useReady()
    return ready && Loaded ? <Loaded {...props} /> : chartLoading()
  }

  return { Chart, useReady }
}

const entriesLineChart = lazyChart<EntriesLineChartProps>(() =>
  import('./EntriesLineChart').then((module) => module.EntriesLineChart),
)
const fleetDonut = lazyChart<FleetDonutProps>(() =>
  import('./FleetDonut').then((module) => module.FleetDonut),
)

export const EntriesLineChart = entriesLineChart.Chart
export const useEntriesLineChartReady = entriesLineChart.useReady
export const FleetDonut = fleetDonut.Chart
export const useFleetDonutReady = fleetDonut.useReady

// Type-only re-exports: erased at compile time, so they pull in no runtime
// code and no recharts.
export type {
  EntriesLineChartProps,
  EntriesLinePoint,
} from './EntriesLineChart'
export type { FleetDonutProps, FleetDonutSlice } from './FleetDonut'
