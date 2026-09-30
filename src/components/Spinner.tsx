import { Loader2 } from 'lucide-react'
import { Spinner as StatusSpinner } from '@/components/ui/Spinner'

export function Spinner({ size = 24 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" />
}

/**
 * The loader for the phase before the application shell exists: the auth
 * bootstrap, when nothing is known about the user yet.
 *
 * It is deliberately not shaped like a page. It used to draw a full fake
 * dashboard, which then gave way to the real header, then to the screen's own
 * skeleton, and read as one page appearing, vanishing and coming back. It sits
 * on the same surface as `Layout`, so the shell appearing behind it is not a
 * colour change. Screens that load inside the shell use `RouteFallback`.
 */
export function FullPageSpinner() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-surface p-4">
      <StatusSpinner size="lg" />
    </div>
  )
}

export function InlineSpinner({ label }: { label?: string }) {
  return (
    <div className="space-y-2 py-2" aria-busy="true" aria-label={label}>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-4/5" />
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-lg bg-surface-hover ${className}`} />
  )
}
