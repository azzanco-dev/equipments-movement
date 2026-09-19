import type { ReactNode } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { Button } from './Button'
import { Card, SectionHeader } from './Card'
import { cn } from './cn'
import { DataTable, type DataTableColumn } from './DataTable'

export interface MiniTableProps<Row> {
  title: ReactNode
  /** Short supporting line under the title. */
  description?: ReactNode
  columns: DataTableColumn<Row>[]
  rows: Row[]
  /** Stable React key per row. */
  rowKey: (row: Row) => string | number
  /** Caps the rendered rows; the caller's full data set is reachable through
   *  "View all" instead of growing the card. */
  maxRows?: number
  /** Renders "View all" as a link. Use `onViewAll` when navigation is handled
   *  in code instead. */
  viewAllHref?: string
  onViewAll?: () => void
  loading?: boolean
  error?: ReactNode
  empty?: ReactNode
  onRowClick?: (row: Row) => void
  className?: string
}

/**
 * Compact card table meant to sit three across on desktop (see
 * `MiniTableGrid`) and stacked on mobile. Wraps `Card` + `SectionHeader` +
 * `DataTable` at `size="md"` with a fixed row cap so a dashboard of these
 * never grows tall regardless of the underlying dataset. Cell content wraps
 * instead of forcing the card wider, since `DataTable` cells default to
 * `whitespace-nowrap`.
 */
export function MiniTable<Row>({
  title,
  description,
  columns,
  rows,
  rowKey,
  maxRows = 5,
  viewAllHref,
  onViewAll,
  loading = false,
  error,
  empty,
  onRowClick,
  className,
}: MiniTableProps<Row>) {
  const { t } = useI18n()
  const visibleRows = rows.slice(0, maxRows)

  // The `td` itself is `whitespace-nowrap`; wrapping the rendered cell in a
  // `whitespace-normal` span overrides that through CSS inheritance (an
  // element's own explicit value always wins over an inherited one) without
  // depending on class-order in the compiled stylesheet.
  const wrappedColumns: DataTableColumn<Row>[] = columns.map((column) => ({
    ...column,
    cell: (row) => (
      <span className="block whitespace-normal break-words">
        {column.cell(row)}
      </span>
    ),
  }))

  const action = viewAllHref ? (
    <Button asChild size="sm" variant="ghost">
      <a href={viewAllHref}>{t('viewAll')}</a>
    </Button>
  ) : onViewAll ? (
    <Button size="sm" variant="ghost" onClick={onViewAll}>
      {t('viewAll')}
    </Button>
  ) : undefined

  return (
    <Card padded={false} className={cn('flex min-w-0 flex-col', className)}>
      <div className="p-4 pb-0">
        <SectionHeader
          title={title}
          description={description}
          action={action}
        />
      </div>
      <div className="p-4">
        <DataTable
          columns={wrappedColumns}
          rows={visibleRows}
          rowKey={rowKey}
          loading={loading}
          loadingRows={Math.min(maxRows, 5)}
          error={error}
          empty={empty}
          onRowClick={onRowClick}
          size="md"
          stickyHeader={false}
          caption={typeof title === 'string' ? title : undefined}
        />
      </div>
    </Card>
  )
}

export interface MiniTableGridProps {
  children: ReactNode
  className?: string
}

/** Places `MiniTable` cards two across on tablets and three across on desktop,
 *  each column sized `minmax(0, 1fr)` (Tailwind's `grid-cols-*` default) so
 *  cards shrink instead of forcing horizontal page overflow. */
export function MiniTableGrid({ children, className }: MiniTableGridProps) {
  return (
    <div className={cn('grid gap-4 md:grid-cols-2 xl:grid-cols-3', className)}>
      {children}
    </div>
  )
}
