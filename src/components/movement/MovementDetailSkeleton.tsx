import { useI18n } from '@/i18n/I18nContext'
import { Card, Skeleton } from '@/components/ui'

// One icon, label bar and value bar, matching an InfoGrid cell.
function FieldSkeleton({ valueWidth }: { valueWidth: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Skeleton variant="circle" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton variant="text" className="w-1/3" />
        <Skeleton variant="text" className={`h-4 ${valueWidth}`} />
      </div>
    </div>
  )
}

// A section title over an InfoGrid (1 column on mobile, 2 from `sm`, 3 from
// `lg`), matching `InfoGridSection`.
function SectionSkeleton({
  titleWidth,
  widths,
}: {
  titleWidth: string
  widths: string[]
}) {
  return (
    <div className="space-y-3">
      <Skeleton variant="text" className={`h-4 ${titleWidth}`} />
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {widths.map((width, index) => (
          <FieldSkeleton key={index} valueWidth={width} />
        ))}
      </div>
    </div>
  )
}

/** First-load placeholder for the movement detail page. It mirrors the real
 * layout (back button, then one card with the DetailHeader, the movement,
 * linked movement, equipment, company/project and driver sections, the photo
 * gallery and the audit line) so the page does not jump when the data
 * arrives. */
export function MovementDetailSkeleton() {
  const { t } = useI18n()
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>

      {/* Back button */}
      <Skeleton className="h-7 w-28" />

      <Card className="space-y-6">
        {/* DetailHeader: identifier + ENTRY/EXIT badge, subtitle, actions */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <Skeleton variant="text" className="w-40 max-w-full" />
          </div>
          <Skeleton className="h-9 w-9" />
        </div>

        <SectionSkeleton titleWidth="w-24" widths={['w-1/2', 'w-2/3']} />
        <SectionSkeleton titleWidth="w-28" widths={['w-1/2']} />
        <SectionSkeleton
          titleWidth="w-24"
          widths={['w-1/3', 'w-1/2', 'w-2/5']}
        />
        <SectionSkeleton
          titleWidth="w-32"
          widths={['w-3/4', 'w-2/3', 'w-1/3']}
        />
        <SectionSkeleton titleWidth="w-16" widths={['w-2/3', 'w-1/2']} />

        {/* Photos: PhotoGallery main preview and three squares */}
        <div className="space-y-3">
          <Skeleton variant="text" className="h-4 w-16" />
          <div className="max-w-lg space-y-2">
            <Skeleton className="aspect-[4/3] w-full" />
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="aspect-square w-full" />
              ))}
            </div>
          </div>
        </div>

        {/* Audit line */}
        <div className="border-t pt-3">
          <Skeleton variant="text" className="w-48 max-w-full" />
        </div>
      </Card>
    </div>
  )
}
