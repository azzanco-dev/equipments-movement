import { Search } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Skeleton } from '@/components/ui'

/**
 * While the inquiry's answer is fetched: an animated search mark (owner
 * 2026-10-27: «"نبحث عن ..." ابغاه يكون ايقونة انيماشن شكل اجمل») — a
 * magnifier circling over two soft pulsing halos, «جار البحث عن» with the
 * unit's code under it — then the shape of the answer.
 */
export function InquiryThinking({ code }: { code: string }) {
  const { t } = useI18n()
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex flex-col items-center gap-3 py-2" role="status">
        <span aria-hidden="true" className="relative flex h-16 w-16 items-center justify-center">
          <span
            className="inq-halo absolute inset-0 rounded-full"
            style={{ backgroundColor: 'var(--chart-3)' }}
          />
          <span
            className="inq-halo absolute inset-0 rounded-full"
            style={{ backgroundColor: 'var(--chart-3)', animationDelay: '900ms' }}
          />
          <span
            className="relative flex h-12 w-12 items-center justify-center rounded-full bg-bg shadow-md"
            style={{ color: 'var(--chart-stroke-3)' }}
          >
            <Search size={20} strokeWidth={2.4} className="inq-seek" />
          </span>
        </span>
        <p className="flex items-center gap-1.5 text-sm text-muted">
          {t('inquiryLooking')}
          {code && (
            <bdi dir="ltr" className="font-semibold text-fg">
              {code}
            </bdi>
          )}
        </p>
      </div>
      <Skeleton className="h-36 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  )
}
