import { useI18n } from '@/i18n/I18nContext'
import { Skeleton } from '@/components/ui'

// One label bar over one value bar, matching a DescriptionList cell.
function FieldSkeleton({ valueWidth }: { valueWidth: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Skeleton variant="circle" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton variant="text" className="w-1/4" />
        <Skeleton variant="text" className={`h-4 ${valueWidth}`} />
      </div>
    </div>
  )
}

const DETAIL_WIDTHS = [
  'w-3/4',
  'w-1/2',
  'w-2/3',
  'w-3/5',
  'w-4/5',
  'w-1/2',
  'w-2/3',
  'w-1/3',
]

/** First-load placeholder for the movement detail page. It mirrors the real
 * layout (header, movement type banner, details card with photo area,
 * equipment card and driver card) so the page does not jump when the data
 * arrives. */
export function MovementDetailSkeleton() {
  const { t } = useI18n()
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>

      {/* Header: back button, title and description, actions */}
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-48" />
          <Skeleton variant="text" className="w-64 max-w-full" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>

      {/* Movement type banner (badge) */}
      <div className="flex items-center gap-3 rounded-xl border p-4">
        <Skeleton variant="circle" className="h-10 w-10 shrink-0" />
        <div className="space-y-2">
          <Skeleton variant="text" className="w-16" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </div>

      {/* Main details card: 2-column grid and the photo gallery */}
      <div className="card">
        <Skeleton variant="text" className="mb-3 h-4 w-28" />
        <div className="grid gap-x-6 sm:grid-cols-2">
          {DETAIL_WIDTHS.map((width, index) => (
            <FieldSkeleton key={index} valueWidth={width} />
          ))}
        </div>
        <div className="mt-4 border-t pt-4">
          <Skeleton variant="text" className="mb-3 w-16" />
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="aspect-square w-full" />
            ))}
          </div>
        </div>
      </div>

      {/* Equipment card */}
      <div className="card">
        <Skeleton variant="text" className="mb-3 h-4 w-32" />
        <div className="grid gap-x-6 sm:grid-cols-2">
          {['w-1/3', 'w-1/2', 'w-2/5'].map((width, index) => (
            <FieldSkeleton key={index} valueWidth={width} />
          ))}
        </div>
      </div>

      {/* Driver card */}
      <div className="card space-y-3">
        <Skeleton variant="text" className="h-4 w-36" />
        <Skeleton variant="text" className="w-48" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  )
}
