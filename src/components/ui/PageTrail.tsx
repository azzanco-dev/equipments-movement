import { createContext, useContext, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/i18n/I18nContext'
import { ArrowLeft, ChevronLeft } from 'lucide-react'
import type { PageTrail as PageTrailModel, TrailCrumb } from '@/lib/pageTrail'
import { AppLink, isPlainLeftClick } from './AppLink'
import { IconButton } from './Button'
import { BackButton } from './BackButton'
import { cn } from './cn'

/**
 * The trail and the back button of a detail or settings page (owner
 * 2026-11-07, approved on /ui-kit «المسار وازرار الرجوع», variant «ب»):
 * from 768 px a small back button, then «المشتريات › اوامر الشراء ›
 * PO-2026110001» with every parent a real link; on a phone one back line
 * (40 px) naming where back leads. App supplies the trail and the back rule
 * (src/lib/pageTrail.ts, src/lib/backNavigation.ts) through the context.
 */

export interface PageTrailValue {
  trail: PageTrailModel
  /** The back rule: the page before in this tab, else the parent list. */
  back: () => void
  /** «رجوع الى اوامر الشراء» when back leads to the parent, else «رجوع». */
  backLabel: string
  /** The phone's back line: the parent's name, or «رجوع». */
  phoneLabel: string
}

const PageTrailContext = createContext<PageTrailValue | null>(null)

export function PageTrailProvider({
  value,
  children,
}: {
  value: PageTrailValue | null
  children: ReactNode
}) {
  return (
    <PageTrailContext.Provider value={value}>
      {children}
    </PageTrailContext.Provider>
  )
}

export function usePageTrail(): PageTrailValue | null {
  return useContext(PageTrailContext)
}

export interface PageTrailBarProps {
  /** Replaces the back rule (a page that first asks about unsaved changes). */
  onBack?: () => void
  /** Asked before a crumb navigates (unsaved changes); false stays. */
  confirmLeave?: () => Promise<boolean>
  /** Outside a trail (a /ui-kit preview): the plain back button's label. */
  fallbackLabel?: string
  className?: string
}

export function PageTrailBar({
  onBack,
  confirmLeave,
  fallbackLabel,
  className,
}: PageTrailBarProps) {
  const value = usePageTrail()
  if (!value)
    return onBack ? (
      <BackButton onClick={onBack} label={fallbackLabel} className={className} />
    ) : null
  const back = onBack ?? value.back
  return (
    <div className={cn('min-w-0', className)}>
      <div className="hidden min-w-0 items-center gap-2 md:flex">
        <IconButton
          size="sm"
          variant="outline"
          label={value.backLabel}
          icon={<ArrowLeft size={15} aria-hidden="true" className="rtl-flip" />}
          onClick={back}
          className="shrink-0 text-muted hover:text-fg"
        />
        <Breadcrumbs crumbs={value.trail.crumbs} confirmLeave={confirmLeave} />
      </div>
      <button
        type="button"
        onClick={back}
        className="-ms-1 inline-flex h-10 items-center gap-1.5 rounded-md px-1 text-sm text-muted hover:text-fg md:hidden"
      >
        <ArrowLeft size={16} aria-hidden="true" className="rtl-flip" />
        {value.phoneLabel}
      </button>
    </div>
  )
}

export function Breadcrumbs({
  crumbs,
  confirmLeave,
}: {
  crumbs: readonly TrailCrumb[]
  confirmLeave?: () => Promise<boolean>
}) {
  const router = useRouter()
  const { t } = useI18n()
  const last = crumbs.length - 1
  return (
    <nav aria-label={t('breadcrumbLabel')} className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[13px] text-muted">
        {crumbs.map((crumb, index) => (
          <li
            key={`${index}:${crumb.label}`}
            className="flex min-w-0 items-center gap-1"
          >
            {index > 0 && (
              <ChevronLeft
                size={14}
                aria-hidden="true"
                className="shrink-0 text-placeholder"
              />
            )}
            {index === last ? (
              crumb.label ? (
                <span
                  aria-current="page"
                  className="truncate font-medium text-fg"
                >
                  <bdi>{crumb.label}</bdi>
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className="inline-block h-3.5 w-20 animate-pulse rounded bg-surface"
                />
              )
            ) : crumb.href ? (
              <AppLink
                href={crumb.href}
                onClick={(event) => {
                  if (!confirmLeave || !isPlainLeftClick(event)) return
                  event.preventDefault()
                  const href = crumb.href as string
                  void confirmLeave().then((leave) => {
                    if (leave) router.push(href)
                  })
                }}
                className="rounded px-0.5 underline-offset-4 hover:text-fg hover:underline"
              >
                {crumb.label}
              </AppLink>
            ) : (
              <span className="px-0.5">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
