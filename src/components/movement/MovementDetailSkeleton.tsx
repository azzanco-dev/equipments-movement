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

// One card holding a section title over an InfoGrid (1 column on mobile, 2
// from `sm`, 3 from `lg`), matching a `Card` around `InfoGridSection`.
function SectionCardSkeleton({
  titleWidth,
  widths,
}: {
  titleWidth: string
  widths: string[]
}) {
  return (
    <Card as="div" className="space-y-3">
      <Skeleton variant="text" className={`h-4 ${titleWidth}`} />
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {widths.map((width, index) => (
          <FieldSkeleton key={index} valueWidth={width} />
        ))}
      </div>
    </Card>
  )
}

/** First-load placeholder for the movement detail page. It mirrors the real
 * boxed layout (wave7-V2): back button, the header card (DetailHeader and the
 * audit line), then one card each for the movement, equipment,
 * company/project and driver sections, the photo gallery and, last, the
 * linked movement, so the page does not jump when the data arrives. */
export function MovementDetailSkeleton() {
  const { t } = useI18n()
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>

      {/* Back button */}
      <Skeleton className="h-7 w-28" />

      {/* Header card: identifier + ENTRY/EXIT badge, subtitle, actions, and
          the audit line as its footer */}
      <Card as="div" className="space-y-3">
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
        <div className="border-t pt-3">
          <Skeleton variant="text" className="w-48 max-w-full" />
        </div>
      </Card>

      {/* Movement */}
      <SectionCardSkeleton titleWidth="w-24" widths={['w-1/2', 'w-2/3']} />
      {/* Equipment */}
      <SectionCardSkeleton
        titleWidth="w-24"
        widths={['w-1/3', 'w-1/2', 'w-2/5']}
      />
      {/* Company and project */}
      <SectionCardSkeleton
        titleWidth="w-32"
        widths={['w-3/4', 'w-2/3', 'w-1/3']}
      />
      {/* Driver */}
      <SectionCardSkeleton titleWidth="w-16" widths={['w-2/3', 'w-1/2']} />

      {/* Photos: PhotoGallery main preview and three squares */}
      <Card as="div" className="space-y-3">
        <Skeleton variant="text" className="h-4 w-16" />
        <div className="max-w-lg space-y-2">
          <Skeleton className="aspect-[4/3] w-full" />
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="aspect-square w-full" />
            ))}
          </div>
        </div>
      </Card>

      {/* Linked movement, last */}
      <SectionCardSkeleton titleWidth="w-28" widths={['w-1/2']} />
    </div>
  )
}
