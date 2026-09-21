import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Select } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { PAGE_SIZE_OPTIONS } from './types'

export function DataListPagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  pageSizeOptions,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  /** Renders the compact page-size select next to the page controls
   *  (moved here from the toolbar, 2026-09-21). Omit to hide it. */
  onPageSize?: (size: number) => void
  pageSizeOptions?: readonly number[]
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const { t, dir } = useI18n()
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-muted">
        {t('resultsCount').replace('{count}', String(total))}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSize && (
          <Select
            size="sm"
            className="w-[78px]"
            aria-label={t('rowsPerPage')}
            value={String(pageSize)}
            onValueChange={(value) => onPageSize(Number(value))}
            options={(pageSizeOptions ?? PAGE_SIZE_OPTIONS).map((value) => ({
              value: String(value),
              label: String(value),
            }))}
          />
        )}
        <div className="flex items-center gap-2">
          <button
            className="btn-outline px-3"
            disabled={page <= 1}
            aria-label={t('previousPage')}
            onClick={() => onPage(page - 1)}
          >
            {dir === 'rtl' ? (
              <ChevronRight size={16} />
            ) : (
              <ChevronLeft size={16} />
            )}
          </button>
          <span>
            {page} / {pages}
          </span>
          <button
            className="btn-outline px-3"
            disabled={page >= pages}
            aria-label={t('nextPage')}
            onClick={() => onPage(page + 1)}
          >
            {dir === 'rtl' ? (
              <ChevronLeft size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
