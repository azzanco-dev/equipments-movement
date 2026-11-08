import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  Filter,
  MoreHorizontal,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { countActiveFilters, type FilterBarAsyncField } from './FilterBar'
import { FilterDialog } from './FilterDialog'
import { useListLabel } from './labels'
import { type DataListConfig, type FilterField, type ListFilter } from './types'
import { useI18n } from '@/i18n/I18nContext'
import { Button, IconButton, SearchInput } from '@/components/ui'

/**
 * Search, filters, sort and actions row of the shared list system.
 *
 * Filters live behind the toolbar's "Filters" button again (owner review,
 * 2026-09-29): it opens `FilterDialog`, whose body is `FilterBar` (one small
 * select-style control per allowlisted field, not the old field / operator /
 * value builder). Lists no longer render `FilterBar` inline.
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
  /**
   * Filter contract (wave 7, 2026-09-29). When `filterFields` is non-empty
   * the toolbar renders a "Filters" button showing the active count
   * («الفلاتر (2)») that opens `FilterDialog`; when it is empty or omitted
   * the button is hidden (companies, projects and lessors rely on the search
   * box alone). Screens pass their config's allowlist plus the URL-backed
   * list state and stop rendering `<FilterBar>` inline:
   *
   *   <DataListToolbar
   *     config={logsListConfig}
   *     …search / sort props…
   *     filterFields={logsListConfig.filterFields}
   *     filters={list.filters}
   *     onFilters={list.setFilters}
   *     asyncFields={asyncFields}
   *   />
   *
   * - `filters` / `onFilters`: the complete `ListFilter[]` (URL state from
   *   `useDataListState`); every change is applied immediately.
   * - `asyncFields`: field key → `FilterBarAsyncField` for relational fields
   *   (server-side search, 20 results; `resolveOption` / `resolveOptions`
   *   turn ids restored from the URL back into labels). A field with
   *   `multiple: true` becomes a multi-select emitting `in`.
   */
  filterFields?: FilterField[]
  /** Current filters; see `filterFields`. */
  filters?: ListFilter[]
  /** Receives the complete next filter list; see `filterFields`. */
  onFilters?: (filters: ListFilter[]) => void
  /** Relational filter searches by field key; see `filterFields`. */
  asyncFields?: Record<string, FilterBarAsyncField>
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
  filterFields,
  filters = [],
  onFilters,
  asyncFields,
}: ToolbarProps) {
  const { t } = useI18n()
  const listLabel = useListLabel()
  const [open, setOpen] = useState<'sort' | 'actions' | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const hasFilters = !!filterFields?.length && !!onFilters
  const activeFilters = countActiveFilters(filters)
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
  // Controls in the main row take the search field's height: `md` beside the
  // normal field, `sm` in the compact toolbar.
  const controlSize = compact ? 'sm' : 'md'
  const toggle = (target: 'sort' | 'actions') =>
    setOpen((current) => (current === target ? null : target))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-[220px] w-full sm:w-[360px] lg:w-[460px]"
          size={compact ? 'sm' : 'md'}
          dir={config.id === 'equipment' ? 'ltr' : undefined}
          value={search}
          onValueChange={onSearch}
          placeholder={listLabel(config.searchPlaceholder)}
          aria-label={listLabel(config.searchPlaceholder)}
        />
        <div className="flex items-center gap-2 sm:ms-auto">
          {hasFilters && (
            <Button
              variant="outline"
              size={controlSize}
              aria-haspopup="dialog"
              onClick={() => {
                setOpen(null)
                setFiltersOpen(true)
              }}
            >
              <Filter size={15} aria-hidden="true" />
              <span>
                {t('filters')}
                {activeFilters > 0 ? ` (${activeFilters})` : ''}
              </span>
            </Button>
          )}
          <div className="relative">
            <Button
              variant="outline"
              size={controlSize}
              data-list-trigger="true"
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
            </Button>
            {open === 'sort' && (
              // On a phone the sort button sits near the start edge, so the
              // box hangs from its start side and opens inward; from `sm`
              // it keeps hanging from the end side (owner 2026-10-26: it
              // ran off the screen on the phone).
              <div
                data-list-popover="true"
                className="absolute start-0 top-[calc(100%+8px)] z-40 min-w-[230px] rounded-xl border py-2 shadow-xl sm:start-auto sm:end-0"
                style={{
                  background: 'var(--bg)',
                  borderColor: 'var(--border)',
                }}
              >
                <div
                  className="flex gap-1 border-b px-2 pb-2"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={direction === 'asc'}
                    className={`flex-1 ${direction === 'asc' ? 'bg-surface-hover' : ''}`}
                    onClick={() => {
                      onSort(sort, 'asc')
                      setOpen(null)
                    }}
                  >
                    {t('ascending')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={direction === 'desc'}
                    className={`flex-1 ${direction === 'desc' ? 'bg-surface-hover' : ''}`}
                    onClick={() => {
                      onSort(sort, 'desc')
                      setOpen(null)
                    }}
                  >
                    {t('descending')}
                  </Button>
                </div>
                <div className="max-h-72 overflow-y-auto p-1">
                  {config.sortableFields.map((field) => (
                    <button
                      key={field.key}
                      className={`flex w-full items-center rounded-lg px-3 py-2 text-start text-sm hover:bg-surface-hover ${field.key === sort ? 'font-semibold' : ''}`}
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
            <IconButton
              variant="outline"
              size={controlSize}
              data-list-trigger="true"
              onClick={() => toggle('actions')}
              label={t('moreActions')}
              icon={<MoreHorizontal size={18} />}
            />
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
      {hasFilters && onFilters && (
        <FilterDialog
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          fields={filterFields ?? []}
          filters={filters}
          onChange={onFilters}
          asyncFields={asyncFields}
        />
      )}
    </div>
  )
}
