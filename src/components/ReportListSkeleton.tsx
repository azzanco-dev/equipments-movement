import { Skeleton } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'

/**
 * First-load placeholder for the report lists: the same two-column grid of
 * cards the rows arrive in, so the list does not jump when they do. It is for
 * the first load only — a refetch keeps the previous rows on screen, dimmed.
 */
export function ReportListSkeleton({ cards = 4 }: { cards?: number }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-3 lg:grid-cols-2" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>
      {Array.from({ length: cards }).map((_, index) => (
        <div key={index} className="card space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton variant="text" className="w-1/3" />
              <Skeleton variant="text" className="w-1/2" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Skeleton variant="text" className="w-3/4" />
            <Skeleton variant="text" className="w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
