import { ChevronLeft, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from '@/components/ui/cn'

export interface InquiryCardProps {
  className?: string
}

/**
 * Wide entry point to `/inquiry` (equipment current state + visit history),
 * shown on both the foreman and workshop homes right under the entry/exit
 * buttons. Styled like `StatCard`'s clickable variant so it reads as part of
 * the same dashboard, but visually secondary to the two big action buttons.
 */
export function InquiryCard({ className }: InquiryCardProps) {
  const { t } = useI18n()
  const router = useRouter()

  return (
    <button
      type="button"
      onClick={() => router.push('/inquiry')}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border bg-bg p-3 text-start transition-colors hover:border-fg hover:bg-surface-hover',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-fg"
      >
        <Search size={17} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-fg">
          {t('inquiryCardTitle')}
        </span>
        <span className="truncate-safe block text-xs text-muted">
          {t('inquiryCardDescription')}
        </span>
      </span>
      <ChevronLeft
        size={16}
        aria-hidden="true"
        className="shrink-0 text-muted ltr:rotate-180"
      />
    </button>
  )
}
