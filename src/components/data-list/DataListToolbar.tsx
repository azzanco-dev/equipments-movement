import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  MoreHorizontal,
  Search,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useListLabel } from './labels'
import { type DataListConfig } from './types'
import { useI18n } from '@/i18n/I18nContext'

/**
 * Search, sort and actions row of the shared list system.
 *
 * Filtering is no longer part of the toolbar: the filter popover (field /
 * operator / value builder rows) was replaced by `FilterBar`, which each list
 * renders between this toolbar and its table (wave 7, 2026-09-29).
 */
interface ToolbarProps {
  config: DataListConfig
  search: string
  onSearch: (value: string) => void
  sort: string
  direction: 'asc' | 'desc'
  onSort: (field: string, direction: 'asc' | 'desc') => void
  /**
   * @deprecated The page-size control moved to `DataListPagination`
   * (2026-09-21). Kept optional here so existing callers still type-check;
   * the toolbar no longer renders it.
   */
  pageSize?: number
  /** @deprecated see `pageSize` above. */
  onPageSize?: (size: number) => void
  selectedCount?: number
  bulkActions?: ReactNode
  actions?: ReactNode
  menuActions?: ReactNode
  primaryAction?: ReactNode
  compact?: boolean
}

export function DataListToolbar({
  config,
  search,
  onSearch,
  sort,
  direction,
  onSort,
  selectedCount = 0,
  bulkActions,
  actions,
  menuActions,
  primaryAction,
  compact = false,
}: ToolbarProps) {
  const { t } = useI18n()
  const listLabel = useListLabel()
  const [open, setOpen] = useState<'sort' | 'actions' | null>(null)
  const currentSort = config.sortableFields.find((field) => field.key === sort)
  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Element
      if (
        target.closest?.(
          '[data-select-portal="true"], [data-list-popover="true"], [data-list-trigger="true"]',
        )
      )
        return
      setOpen(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const toggle = (target: 'sort' | 'actions') =>
    setOpen((current) => (current === target ? null : target))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] w-full sm:w-[360px] lg:w-[460px]">
          <Search
            size={compact ? 14 : 16}
            className={`absolute top-1/2 -translate-y-1/2 text-muted ${config.id === 'equipment' ? 'left-3' : 'start-3'}`}
          />
          <input
            className={`input ps-9 ${compact ? 'h-8 py-1 text-sm' : ''} ${config.id === 'equipment' ? 'text-left' : ''}`}
            dir={config.id === 'equipment' ? 'ltr' : undefined}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={listLabel(config.searchPlaceholder)}
          />
        </div>
        <div className="flex items-center gap-2 sm:ms-auto">
          <div className="relative">
            <button
              data-list-trigger="true"
              className="btn-outline"
              onClick={() => toggle('sort')}
            >
              {direction === 'asc' ? (
                <ArrowUpAZ size={15} />
              ) : (
                <ArrowDownAZ size={15} />
              )}
              <span className="hidden sm:inline">
                {currentSort ? listLabel(currentSort.label) : t('sortBy')}
              </span>
              <ChevronDown size={14} />
            </button>
            {open === 'sort' && (
              <div
                data-list-popover="true"
                className="absolute end-0 top-[calc(100%+8px)] z-40 min-w-[230px] rounded-xl border py-2 shadow-xl"
                style={{
                  background: 'var(--bg)',
                  borderColor: 'var(--border)',
                }}
              >
                <div
                  className="flex gap-1 border-b px-2 pb-2"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <button
                    className={`btn-ghost flex-1 ${direction === 'asc' ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
                    onClick={() => {
                      onSort(sort, 'asc')
                      setOpen(null)
                    }}
                  >
                    {t('ascending')}
                  </button>
                  <button
                    className={`btn-ghost flex-1 ${direction === 'desc' ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
                    onClick={() => {
                      onSort(sort, 'desc')
                      setOpen(null)
                    }}
                  >
                    {t('descending')}
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto p-1">
                  {config.sortableFields.map((field) => (
                    <button
                      key={field.key}
                      className={`flex w-full items-center rounded-lg px-3 py-2 text-start text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${field.key === sort ? 'font-semibold' : ''}`}
                      onClick={() => {
                        onSort(field.key, direction)
                        setOpen(null)
                      }}
                    >
                      {listLabel(field.label)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        {menuActions && (
          <div className="relative">
            <button
              data-list-trigger="true"
              className="btn-outline px-2.5"
              onClick={() => toggle('actions')}
              aria-label={t('moreActions')}
            >
              <MoreHorizontal size={18} />
            </button>
            {open === 'actions' && (
              <div
                data-list-popover="true"
                className="absolute end-0 top-[calc(100%+8px)] z-40 min-w-[190px] space-y-1 rounded-xl border p-2 shadow-xl [&>button]:w-full [&>button]:justify-start"
                style={{
                  background: 'var(--bg)',
                  borderColor: 'var(--border)',
                }}
                onClick={() => setOpen(null)}
              >
                {menuActions}
              </div>
            )}
          </div>
        )}
        {actions}
        {primaryAction}
      </div>
      {selectedCount > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)' }}
        >
          <b>{t('selectedCount').replace('{count}', String(selectedCount))}</b>
          {bulkActions}
        </div>
      )}
    </div>
  )
}
