import { Skeleton } from '@/components/ui/Skeleton'
import { useI18n } from '@/i18n/I18nContext'

export type RouteFallbackVariant = 'page' | 'list'

/**
 * A bar that sits directly on the page background. The shared `Skeleton` is
 * drawn on `--surface`, which is the colour of `<main>` itself, so it is only
 * visible inside a card; bars outside one use the hover surface, the same
 * token `DataTable` uses for its skeleton rows.
 */
function Bar({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-surface-hover ${className}`}
    />
  )
}

const ROW_WIDTHS = ['w-2/3', 'w-1/2', 'w-3/5', 'w-2/5', 'w-3/4', 'w-1/2']

/**
 * What `<main>` shows while a screen's code is still downloading.
 *
 * It lives inside the shell, so it has no background and no minimum height of
 * its own, and it is shaped like the first frame every screen draws — a page
 * header over one content block — so handing over to the screen's own skeleton
 * moves nothing. `list` adds the toolbar and table rows of the list screens.
 *
 * It also waits before it appears (the fade-in starts after 150 ms). A chunk
 * that is already cached or arrives quickly therefore shows nothing at all,
 * instead of a placeholder that flashes for a frame and is then replaced.
 */
export function RouteFallback({
  variant = 'page',
}: {
  variant?: RouteFallbackVariant
}) {
  const { t } = useI18n()
  return (
    <div
      aria-busy="true"
      className="animate-[fade-in-opacity_0.2s_ease-out_0.15s_both] space-y-4"
    >
      <span className="sr-only" role="status">
        {t('loading')}
      </span>

      {/* Same box as `PageHeader`: title line, description line, divider. */}
      <div className="border-b pb-5">
        <Bar className="h-8 w-44" />
        <Bar className="mt-1.5 h-5 w-72 max-w-full" />
      </div>

      {variant === 'list' ? (
        <>
          <Bar className="h-10 w-full max-w-md md:h-9" />
          <div className="rounded-xl border bg-bg">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="flex h-11 items-center border-b px-3 last:border-0 md:h-10"
              >
                <Bar
                  className={`h-3 ${ROW_WIDTHS[index % ROW_WIDTHS.length]}`}
                />
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3 rounded-xl border bg-bg p-5">
          <Skeleton variant="text" className="w-1/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton variant="text" className="w-2/3" />
          <Skeleton variant="text" className="w-1/2" />
        </div>
      )}
    </div>
  )
}
