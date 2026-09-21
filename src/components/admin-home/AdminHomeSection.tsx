import type { ReactNode } from 'react'
import { ErrorState, Skeleton } from '@/components/ui'
import { CollapsibleSection } from '@/components/home/CollapsibleSection'
import { useI18n } from '@/i18n/I18nContext'

export interface AdminHomeSectionProps {
  title: ReactNode
  description?: ReactNode
  /** Trailing slot of the heading row (a chip, a segmented control). */
  action?: ReactNode
  loading?: boolean
  /** A failed load. Never rendered as an empty state. */
  failed?: boolean
  onRetry?: () => void
  /** Height of the skeleton placeholder while the section loads. */
  skeletonClassName?: string
  highlight?: boolean
  bodyClassName?: string
  children: ReactNode
}

/**
 * One admin-home section: heading, its own loading placeholder, and its own
 * failure state with a retry.
 *
 * Every section loads independently, so this is where the three outcomes are
 * kept apart — loading, failed, and loaded. A failed load renders `ErrorState`
 * (danger-soft, with a retry button) and never the section's empty table, so a
 * broken request can never read as "there is nothing to show".
 */
export function AdminHomeSection({
  title,
  description,
  action,
  loading = false,
  failed = false,
  onRetry,
  skeletonClassName = 'h-40 w-full',
  highlight = false,
  bodyClassName = 'space-y-3',
  children,
}: AdminHomeSectionProps) {
  const { t } = useI18n()
  return (
    <CollapsibleSection
      as="h2"
      title={title}
      description={description}
      action={action}
      highlight={highlight}
      bodyClassName={bodyClassName}
    >
      {failed ? (
        <ErrorState
          title={t('adminHomeSectionError')}
          description={t('adminHomeSectionErrorHint')}
          onRetry={onRetry}
        />
      ) : loading ? (
        <>
          <Skeleton className={skeletonClassName} />
          <span className="sr-only">{t('loading')}</span>
        </>
      ) : (
        children
      )}
    </CollapsibleSection>
  )
}
