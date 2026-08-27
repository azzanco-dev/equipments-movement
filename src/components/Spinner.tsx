import { Loader2 } from 'lucide-react'

export function Spinner({ size = 24 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" />
}

export function FullPageSpinner() {
  return (
    <div
      className="min-h-screen p-4 sm:p-8"
      style={{ background: 'var(--bg)' }}
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-12" />
        <Skeleton className="h-72" />
      </div>
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
    <div
      className={`animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800 ${className}`}
    />
  )
}
