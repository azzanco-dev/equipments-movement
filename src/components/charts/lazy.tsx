'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * The only entry point to the Recharts-backed charts.
 *
 * Recharts is approved for the admin home only, so every component that
 * imports it lives under `src/components/charts/` and is reached through the
 * dynamic wrappers below. Nothing else imports `recharts` directly, and the
 * `@/components/charts` barrel stays free of it, so the rest of the
 * application never pays for the library.
 */

const chartLoading = () => <Skeleton className="h-64 w-full" />

export const EntriesLineChart = dynamic(
  () => import('./EntriesLineChart').then((module) => module.EntriesLineChart),
  { ssr: false, loading: chartLoading },
)

export const FleetDonut = dynamic(
  () => import('./FleetDonut').then((module) => module.FleetDonut),
  { ssr: false, loading: chartLoading },
)

// Type-only re-exports: erased at compile time, so they pull in no runtime
// code and no recharts.
export type {
  EntriesLineChartProps,
  EntriesLinePoint,
} from './EntriesLineChart'
export type { FleetDonutProps, FleetDonutSlice } from './FleetDonut'
