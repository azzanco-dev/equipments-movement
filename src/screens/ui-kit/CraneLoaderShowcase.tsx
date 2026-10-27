import { CraneLoader } from '@/components/CraneLoader'
import { Spinner } from '@/components/ui'

/**
 * The crane loader for review (owner 2026-10-27: «ابغا اغيره لكرين ايكون
 * مثلا، متحرك» › «سويه في ui-kit»): the start-up loader as it would be,
 * beside the current spinner, at its size and smaller. The start-up loader
 * itself (`FullPageSpinner`) changes only once this is approved.
 */
export function CraneLoaderShowcase() {
  return (
    <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
      <figure className="space-y-2">
        <div className="flex min-h-[260px] items-center justify-center rounded-2xl bg-surface">
          <CraneLoader />
        </div>
        <figcaption className="text-xs text-muted">
          الكرين على خلفية الصفحة كما سيظهر عند فتح الموقع.
        </figcaption>
      </figure>
      <div className="grid grid-rows-2 gap-4">
        <figure className="space-y-2">
          <div className="flex min-h-[110px] items-center justify-center rounded-2xl bg-surface">
            <CraneLoader size={64} />
          </div>
          <figcaption className="text-xs text-muted">حجم اصغر.</figcaption>
        </figure>
        <figure className="space-y-2">
          <div className="flex min-h-[110px] items-center justify-center rounded-2xl bg-surface">
            <Spinner size="lg" />
          </div>
          <figcaption className="text-xs text-muted">المؤشر الحالي، للمقارنة.</figcaption>
        </figure>
      </div>
    </div>
  )
}
