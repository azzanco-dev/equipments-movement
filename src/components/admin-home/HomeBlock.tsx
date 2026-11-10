import type { ReactNode } from 'react'
import {
  AppLink,
  Button,
  Card,
  ErrorState,
  Skeleton,
  cn,
} from '@/components/ui'
import { deepTint } from '@/components/charts'
import { useI18n } from '@/i18n/I18nContext'
import { translations, type TranslationKey } from '@/i18n/translations'
import { CountUp } from './CountUp'

/**
 * One block of the admin home v2 (owner 2026-11-09, the approved /ui-kit
 * «نموذج الرئيسية الجديدة v2», variant «ب»: the current home's spacing):
 * a rounded card with the title, its English under it in small muted text
 * while the page is Arabic (the reference images' header), and an action at
 * the end (a «عرض الكل», a filter). `state` keeps loading, failure and data
 * apart: a failed read is an `ErrorState` with retry, never an empty block.
 * Tighter since the owner's review of 2026-11-10 («قلل المسافات شوي»).
 * The first load shows the block's own `skeleton` (owner 2026-11-09, «واضف
 * skeleton»: the shape of what is coming, at its height); a refetch keeps
 * the body and dims it.
 */
export function HomeBlock({
  title,
  action,
  state,
  onRetry,
  skeleton,
  skeletonClassName = 'h-48 w-full',
  className,
  count,
  id,
  children,
}: {
  title: TranslationKey
  /** A figure beside the title (owner 2026-11-10, «اضف عدد للمتاحة»):
   *  the block's total, counting up; nothing while null. */
  count?: number | null
  action?: ReactNode
  /** `loading` = the first load (a refetch keeps the body and dims it). */
  state?: 'loading' | 'failed' | 'ready'
  onRetry?: () => void
  /** The placeholder shaped like the block's content (`HomeSkeletons`),
   *  shown on the first load only; else one plain skeleton block. */
  skeleton?: ReactNode
  skeletonClassName?: string
  className?: string
  id?: string
  children?: ReactNode
}) {
  const { t, lang } = useI18n()
  return (
    // `Card` takes no id or aria-label, so the section carries them (the
    // Afaqy block keeps its anchor).
    <section
      id={id}
      aria-label={t(title)}
      className={cn('flex min-w-0 scroll-mt-20', className)}
    >
      <Card
        as="div"
        padded={false}
        className="flex w-full min-w-0 flex-col rounded-2xl p-3"
      >
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight">
              {t(title)}
              {count !== undefined && count !== null && (
                <span className="ms-1.5 tabular-nums text-muted">
                  <CountUp value={count} />
                </span>
              )}
            </h2>
            {lang === 'ar' && (
              <p
                className="font-latin text-[11px] leading-tight text-muted"
                dir="ltr"
              >
                {translations.en[title]}
              </p>
            )}
          </div>
          {action && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {action}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {state === 'failed' ? (
            <ErrorState
              title={t('adminHomeSectionError')}
              description={t('adminHomeSectionErrorHint')}
              onRetry={onRetry}
            />
          ) : state === 'loading' ? (
            <>
              {skeleton ?? <Skeleton className={skeletonClassName} />}
              <span className="sr-only">{t('loading')}</span>
            </>
          ) : (
            children
          )}
        </div>
      </Card>
    </section>
  )
}

/** The block's «عرض الكل»: a real link when it opens a page, a button when
 *  it opens the full section in place. Nothing when neither is possible. */
export function ViewAllAction({
  href,
  onClick,
  label = 'viewAll',
}: {
  href?: string | null
  onClick?: () => void
  label?: TranslationKey
}) {
  const { t } = useI18n()
  if (href)
    return (
      <Button asChild size="sm" variant="ghost">
        <AppLink href={href}>{t(label)}</AppLink>
      </Button>
    )
  if (onClick)
    return (
      <Button size="sm" variant="ghost" onClick={onClick}>
        {t(label)}
      </Button>
    )
  return null
}

/** A thin bar of a share, in a light chart shade (the KPI tiles without a
 *  daily series, the supplier rows). */
export function ShareBar({
  value,
  total,
  shade,
  className,
}: {
  value: number
  total: number
  shade: number
  className?: string
}) {
  const width = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block h-2 min-w-0 overflow-hidden rounded-full bg-surface-hover',
        className,
      )}
    >
      <span
        className="bar-grow block h-full rounded-full"
        style={{
          width: `${width}%`,
          backgroundColor: deepTint(
            `var(--chart-${shade})`,
            `var(--chart-stroke-${shade})`,
          ),
        }}
      />
    </span>
  )
}

/** A run of tiny bars in a light chart shade: a real daily series. */
export function MiniBars({
  values,
  shade,
}: {
  values: readonly number[]
  shade: number
}) {
  const max = Math.max(1, ...values)
  return (
    <span aria-hidden="true" className="flex h-6 shrink-0 items-end gap-[2px]">
      {values.map((value, index) => (
        <span
          key={index}
          className="block w-[3px] rounded-t-sm"
          style={{
            height: `${Math.max(12, (value / max) * 100)}%`,
            backgroundColor: deepTint(
              `var(--chart-${shade})`,
              `var(--chart-stroke-${shade})`,
            ),
          }}
        />
      ))}
    </span>
  )
}

/** A row of a bar list: label, bar, count, share (the mockup's `BarRow`). */
export function BarRow({
  label,
  value,
  share,
  width,
  shade,
  labelDir,
  muted = false,
}: {
  label: ReactNode
  value: ReactNode
  share: number
  /** The bar's length in percent of the block's largest row. */
  width: number
  shade: number
  labelDir?: 'ltr'
  muted?: boolean
}) {
  return (
    <span className="flex w-full items-center gap-2 text-sm">
      <span
        className={cn(
          'truncate-safe w-28 shrink-0 text-start sm:w-32',
          muted && 'text-muted',
        )}
        dir={labelDir}
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover"
      >
        <span
          className="bar-grow block h-full rounded-full"
          style={{
            width: `${Math.max(0, Math.min(100, width))}%`,
            backgroundColor: deepTint(
              `var(--chart-${shade})`,
              `var(--chart-stroke-${shade})`,
            ),
          }}
        />
      </span>
      <span className="w-9 shrink-0 text-end font-semibold tabular-nums">
        {value}
      </span>
      <span className="w-9 shrink-0 text-end text-xs tabular-nums text-muted">
        {share}%
      </span>
    </span>
  )
}
