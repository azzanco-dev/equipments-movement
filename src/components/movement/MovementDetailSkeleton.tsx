import { useI18n } from '@/i18n/I18nContext'
import { Skeleton } from '@/components/ui'

// One label bar over one value bar, the same box as a `DescriptionList` cell:
// 8px block padding, a 16px label line and a 26px value line (58px in all).
function FieldSkeleton({ valueWidth }: { valueWidth: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Skeleton variant="circle" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex h-4 items-center">
          <Skeleton variant="text" className="w-1/4" />
        </div>
        <div className="flex h-[26px] items-center">
          <Skeleton variant="text" className={`h-4 ${valueWidth}`} />
        </div>
      </div>
    </div>
  )
}

// A card title: the 20px line of the real `text-sm` heading plus its margin.
function TitleSkeleton({ width }: { width: string }) {
  return (
    <div className="mb-2 flex h-5 items-center">
      <Skeleton variant="text" className={width} />
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

// Site movements list equipment, contractor code, company, project, driver,
// recorder and date; workshop movements only equipment, recorder and date.
// Admins get one more row (created at).
const SITE_FIELD_COUNT = 7
const WORKSHOP_FIELD_COUNT = 3

export interface MovementDetailSkeletonProps {
  /** Decides the number of detail rows and whether the driver card exists.
   *  The page passes the real context as soon as the movement row arrived,
   *  and the likeliest one for the signed-in role before that. */
  context?: 'site' | 'workshop'
  /** Admins have the header menu and the "created at" row. */
  isAdmin?: boolean
  /** Every role but the read-only monitor sees the "add photo" row. */
  canUpload?: boolean
}

/** First-load placeholder for the movement detail page. It mirrors the real
 * layout box for box (header, movement type banner, details card with the
 * fixed 320px photo area, equipment card, driver card for site movements and
 * the linked-movement card) so the page does not jump when the data
 * arrives. */
export function MovementDetailSkeleton({
  context = 'site',
  isAdmin = false,
  canUpload = true,
}: MovementDetailSkeletonProps) {
  const { t } = useI18n()
  const fieldCount =
    (context === 'workshop' ? WORKSHOP_FIELD_COUNT : SITE_FIELD_COUNT) +
    (isAdmin ? 1 : 0)
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>

      {/* Header: back button, title and description; the actions menu is an
          admin-only square icon button, so other roles get no actions row. */}
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Skeleton className="mb-1 h-7 w-20" />
          <div className="flex h-8 items-center">
            <Skeleton className="h-6 w-48" />
          </div>
          <div className="mt-1.5 flex h-[21px] items-center">
            <Skeleton variant="text" className="w-64 max-w-full" />
          </div>
        </div>
        {isAdmin && <Skeleton className="h-10 w-10 shrink-0 md:h-9 md:w-9" />}
      </div>

      {/* Movement type banner: round icon, label line and badge */}
      <div className="card flex items-center gap-3">
        <Skeleton variant="circle" className="h-10 w-10 shrink-0" />
        <div>
          <div className="flex h-4 items-center">
            <Skeleton variant="text" className="w-16" />
          </div>
          <Skeleton className="mt-1 h-[26px] w-20 rounded-full" />
        </div>
      </div>

      {/* Main details card: 2-column grid and the photo area */}
      <div className="card">
        <TitleSkeleton width="w-28" />
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {Array.from({ length: fieldCount }, (_, index) => (
            <FieldSkeleton
              key={index}
              valueWidth={DETAIL_WIDTHS[index % DETAIL_WIDTHS.length]}
            />
          ))}
        </div>
        <div className="mt-4 border-t pt-4">
          <div className="mb-2 flex h-4 items-center gap-3">
            <Skeleton variant="circle" className="h-4 w-4 shrink-0" />
            <Skeleton variant="text" className="w-16" />
          </div>
          {/* Same fixed box as the real photo viewer. */}
          <Skeleton className="h-[320px] w-full" />
          {canUpload && <Skeleton className="mt-3 h-[46px] w-full" />}
        </div>
      </div>

      {/* Equipment card */}
      <div className="card">
        <TitleSkeleton width="w-32" />
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {['w-1/3', 'w-1/2', 'w-2/5'].map((width, index) => (
            <FieldSkeleton key={index} valueWidth={width} />
          ))}
        </div>
      </div>

      {/* Driver card: site movements only */}
      {context === 'site' && (
        <div className="card space-y-4">
          <div>
            <TitleSkeleton width="w-36" />
            <div className="flex h-4 items-center">
              <Skeleton variant="text" className="w-20" />
            </div>
            <div className="flex h-[26px] items-center">
              <Skeleton variant="text" className="h-4 w-40" />
            </div>
          </div>
          <div className="flex h-5 items-center">
            <Skeleton variant="text" className="w-48" />
          </div>
        </div>
      )}

      {/* Linked movement card: always rendered by the page */}
      <div className="card">
        <TitleSkeleton width="w-32" />
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {['w-1/2', 'w-2/5'].map((width, index) => (
            <FieldSkeleton key={index} valueWidth={width} />
          ))}
        </div>
      </div>
    </div>
  )
}
