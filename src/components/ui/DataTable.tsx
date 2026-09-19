import { type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from './cn'

export type DataTableSortDirection = 'asc' | 'desc'
export type DataTableSize = 'sm' | 'md' | 'lg'
export type DataTableAlign = 'start' | 'center' | 'end'

export interface DataTableSort {
  key: string
  direction: DataTableSortDirection
}

export interface DataTableColumn<Row> {
  /** Matches the server sort key used by the list config. */
  key: string
  header: ReactNode
  cell: (row: Row) => ReactNode
  /** Shows the sort control in the header; sorting itself stays server-side. */
  sortable?: boolean
  align?: DataTableAlign
  /** Any CSS width, for example '8rem' or '20%'. */
  width?: string
  /** Extra classes for the body cells of this column. */
  className?: string
  /** Extra classes for the header cell of this column. */
  headerClassName?: string
  /** Hides the column below this breakpoint to keep narrow screens readable. */
  hideBelow?: 'sm' | 'md' | 'lg'
  /** Accessible name for the sort button when `header` is not plain text. */
  sortLabel?: string
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[]
  rows: Row[]
  /** Stable React key per row. */
  rowKey: (row: Row) => string | number
  /** Makes rows clickable with Enter/Space keyboard access. */
  onRowClick?: (row: Row) => void
  /** Current sort, owned by the caller (URL state in the list system). */
  sort?: DataTableSort | null
  /** Called with the requested key and direction; the caller refetches. */
  onSortChange?: (key: string, direction: DataTableSortDirection) => void
  /** Replaces the body with skeleton rows. */
  loading?: boolean
  loadingRows?: number
  /** Truthy renders the error state; `true` uses the default message. */
  error?: ReactNode
  /** Shown when there are no rows and no error. */
  empty?: ReactNode
  size?: DataTableSize
  /** Accessible table name, announced by screen readers. */
  caption?: string
  /** Keeps the header visible while the body scrolls. */
  stickyHeader?: boolean
  /** Enables vertical scrolling inside the table container. */
  maxHeight?: string
  className?: string
  rowClassName?: (row: Row) => string | undefined
}

const sizes: Record<
  DataTableSize,
  { header: string; row: string; cell: string }
> = {
  // Approved control height (2026-09-16): 40 px on mobile, 36 px from md.
  md: { header: 'h-10 md:h-9', row: 'h-11 md:h-10', cell: 'px-3 text-sm' },
  // Matches the 28 px toolbar/table controls.
  sm: { header: 'h-7', row: 'h-7', cell: 'px-2.5 text-[13px]' },
  // Owner feedback (2026-09-19): taller 44 px rows for home-page tables.
  lg: { header: 'h-11', row: 'h-11', cell: 'px-3 text-sm' },
}

const alignText: Record<DataTableAlign, string> = {
  start: 'text-start',
  center: 'text-center',
  end: 'text-end',
}

const alignFlex: Record<DataTableAlign, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
}

// Full class names so Tailwind keeps them in the build.
const hideBelowClass = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
} as const

const skeletonWidths = ['w-16', 'w-24', 'w-20', 'w-28', 'w-20', 'w-24']

/** Elements that handle their own click inside a clickable row. */
const interactiveSelector = 'a,button,input,select,textarea,[role="button"]'

// A click inside a nested control (row action button, checkbox, link) must not
// also open the row. The row itself carries role="button", so the match has to
// stop at the row: without that guard every row click matched the row and was
// swallowed (owner report 2026-09-19: rows in equipment, drivers and workshop
// lists did not open).
function hitsNestedControl(target: EventTarget | null, row: HTMLElement) {
  const hit = (target as HTMLElement | null)?.closest(interactiveSelector)
  return Boolean(hit && hit !== row)
}

/**
 * Presentational table for the shared list system. It never sorts or paginates
 * data: `sort` and `onSortChange` are controlled by the caller so ordering
 * stays server-side. Clicking a sortable header sorts ascending, clicking the
 * active header toggles descending, and the next click returns to ascending.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  sort,
  onSortChange,
  loading = false,
  loadingRows = 5,
  error,
  empty,
  size = 'md',
  caption,
  stickyHeader = true,
  maxHeight,
  className,
  rowClassName,
}: DataTableProps<Row>) {
  const { t } = useI18n()
  const density = sizes[size]
  const hasError = error !== undefined && error !== null && error !== false
  // While a refetch (sort, page, filter) is in flight the current rows stay on
  // screen, dimmed, so column widths do not jump between skeleton and data.
  // The skeleton only appears when there is nothing to show yet.
  const showSkeleton = loading && rows.length === 0
  const refreshing = loading && rows.length > 0
  const isEmpty = !loading && !hasError && rows.length === 0

  const handleSort = (column: DataTableColumn<Row>) => {
    if (!onSortChange) return
    const active = sort?.key === column.key
    onSortChange(
      column.key,
      active && sort?.direction === 'asc' ? 'desc' : 'asc',
    )
  }

  const rowInteraction = (row: Row) => {
    if (!onRowClick) return {}
    return {
      tabIndex: 0,
      role: 'button' as const,
      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
        if (hitsNestedControl(event.target, event.currentTarget)) return
        onRowClick(row)
      },
      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        if (hitsNestedControl(event.target, event.currentTarget)) return
        event.preventDefault()
        onRowClick(row)
      },
    }
  }

  return (
    <div
      className={cn(
        'w-full overflow-x-auto rounded-xl border bg-bg',
        maxHeight && 'overflow-y-auto',
        className,
      )}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table
        className="w-full border-collapse text-start"
        aria-busy={loading || undefined}
      >
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead
          className={cn('bg-surface', stickyHeader && 'sticky top-0 z-10')}
        >
          <tr className="border-b">
            {columns.map((column) => {
              const align = column.align ?? 'start'
              const active = sort?.key === column.key
              const label =
                column.sortLabel ??
                (typeof column.header === 'string' ? column.header : column.key)
              const nextAscending = !active || sort?.direction === 'desc'
              const sortable = Boolean(column.sortable && onSortChange)
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={
                    column.sortable
                      ? active
                        ? sort?.direction === 'desc'
                          ? 'descending'
                          : 'ascending'
                        : 'none'
                      : undefined
                  }
                  className={cn(
                    'whitespace-nowrap text-xs font-medium',
                    density.header,
                    alignText[align],
                    active ? 'text-fg' : 'text-muted',
                    sortable ? 'p-0' : density.cell,
                    sortable && 'text-xs',
                    column.hideBelow && hideBelowClass[column.hideBelow],
                    column.headerClassName,
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(column)}
                      aria-label={`${label}: ${t(nextAscending ? 'sortAscending' : 'sortDescending')}`}
                      title={t(
                        nextAscending ? 'sortAscending' : 'sortDescending',
                      )}
                      className={cn(
                        'group/sort inline-flex w-full items-center gap-1.5 transition-colors hover:bg-surface-hover hover:text-fg',
                        density.header,
                        density.cell,
                        'text-xs',
                        alignFlex[align],
                      )}
                    >
                      <span className="truncate-safe">{column.header}</span>
                      <SortIndicator
                        active={active}
                        direction={sort?.direction ?? 'asc'}
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {showSkeleton &&
            Array.from({ length: Math.max(1, loadingRows) }).map((_, index) => (
              <tr key={`skeleton-${index}`} className="border-b last:border-0">
                {columns.map((column, columnIndex) => (
                  <td
                    key={column.key}
                    className={cn(
                      density.row,
                      density.cell,
                      column.hideBelow && hideBelowClass[column.hideBelow],
                    )}
                  >
                    <span
                      className={cn(
                        'block h-3 animate-pulse rounded bg-surface-hover',
                        skeletonWidths[columnIndex % skeletonWidths.length],
                      )}
                    />
                    <span className="sr-only">{t('loading')}</span>
                  </td>
                ))}
              </tr>
            ))}

          {hasError && (
            <tr>
              <td colSpan={columns.length} className="p-0">
                <div
                  role="alert"
                  className="flex items-start gap-2.5 border-s-4 border-danger bg-danger-soft px-4 py-5 text-sm font-medium text-danger"
                >
                  <AlertCircle
                    size={18}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0"
                  />
                  <span>{error === true ? t('dataLoadError') : error}</span>
                </div>
              </td>
            </tr>
          )}

          {isEmpty && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-sm text-muted"
              >
                {empty ?? t('noResults')}
              </td>
            </tr>
          )}

          {!showSkeleton &&
            !hasError &&
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                {...rowInteraction(row)}
                className={cn(
                  'border-b transition-colors last:border-0 hover:bg-surface-hover',
                  refreshing && 'pointer-events-none opacity-60',
                  onRowClick &&
                    'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  rowClassName?.(row),
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'whitespace-nowrap tabular-nums',
                      density.row,
                      density.cell,
                      alignText[column.align ?? 'start'],
                      column.hideBelow && hideBelowClass[column.hideBelow],
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

/** Arrow for the active column; the other sortable columns always show a muted
 *  up/down hint (owner decision 2026-09-17) that brightens on hover/focus. */
function SortIndicator({
  active,
  direction,
}: {
  active: boolean
  direction: DataTableSortDirection
}) {
  if (!active)
    return (
      <ChevronsUpDown
        size={13}
        aria-hidden="true"
        className="shrink-0 text-muted opacity-70 transition-opacity group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100"
      />
    )
  const Icon = direction === 'asc' ? ArrowUp : ArrowDown
  return <Icon size={13} aria-hidden="true" className="shrink-0 text-fg" />
}
