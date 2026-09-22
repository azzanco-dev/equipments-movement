import { useCallback, useEffect, useState } from 'react'
import { Badge, DataTable, SearchInput } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { useI18n } from '@/i18n/I18nContext'
import { fetchAvailabilityByType } from '@/lib/adminHomeData'
import type {
  AdminHomeOwner,
  AvailabilityRow,
  FleetStateCounts,
} from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { OwnerFilter } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

/** One page of types. Fixed: the section is half a row, not a list page. */
const PAGE_SIZE = 20

/**
 * "التوفر حسب النوع": per equipment type, how many units are inside sites, in
 * the workshop, available, and the total.
 *
 * Owner review (2026-09-22, third pass): the owned / rented sub-lines are gone,
 * the totals column moved to the end so the columns read in the order the
 * operations team thinks in (where the units are first, how many there are
 * last), and the section carries its own owner filter now that the page-level
 * one is gone.
 *
 * The "top 10 / عرض الكل" toggle is gone with it. Searching and paging are the
 * database's job: the type search is sent as `search` (debounced, and any new
 * search starts again at page one) and the table shows 20 types a page, so the
 * browser never receives a type it is not about to draw.
 *
 * A refetch keeps the current page on screen — the skeleton is for the first
 * load only — because replacing a table the user is reading with a placeholder
 * every time they page or type reads as a page that keeps breaking.
 */
export function AvailabilitySection() {
  const { t } = useI18n()
  const [owners, setOwners] = useState<AdminHomeOwner[]>([])
  // `input` is what the user typed; `search` is what the database was asked
  // for. Keeping them apart is what makes the debounce possible without the
  // box ever lagging behind the keyboard.
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const trimmed = input.trim()
    if (trimmed === search) return
    const timer = window.setTimeout(() => {
      setSearch(trimmed)
      // A narrowed list has different pages; page 3 of the old search is not a
      // meaningful place to land.
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [input, search])

  const load = useCallback(
    (signal: AbortSignal) =>
      fetchAvailabilityByType(
        {
          // An empty selection is "every owner", which the database reads as a
          // NULL filter rather than an empty list.
          owners: owners.length ? owners : null,
          search: search || null,
          page,
          pageSize: PAGE_SIZE,
        },
        signal,
      ),
    [owners, page, search],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  // The very first load has nothing to show yet, so it gets the skeleton; every
  // later load keeps the rows that are already on screen.
  const firstLoad = loading && data === null
  const refreshing = loading && data !== null

  const metric = (
    key: string,
    header: string,
    field: keyof FleetStateCounts,
    options: { hideBelow?: 'sm' | 'md' | 'lg'; strong?: boolean } = {},
  ): DataTableColumn<AvailabilityRow> => ({
    key,
    header,
    align: 'end',
    width: '6rem',
    hideBelow: options.hideBelow,
    cell: (row) => (
      <span
        className={
          options.strong
            ? 'font-semibold tabular-nums text-fg'
            : 'tabular-nums text-fg'
        }
      >
        {row[field]}
      </span>
    ),
  })

  const columns: DataTableColumn<AvailabilityRow>[] = [
    {
      key: 'type',
      header: t('adminHomeColType'),
      cell: (row) => <span className="font-medium">{row.type}</span>,
    },
    metric('inside', t('adminHomeColInside'), 'insideSites'),
    metric('workshop', t('adminHomeColWorkshop'), 'inWorkshop', {
      hideBelow: 'sm',
    }),
    metric('available', t('adminHomeColAvailable'), 'available'),
    metric('total', t('adminHomeColTotal'), 'total', { strong: true }),
  ]

  return (
    <AdminHomeSection
      title={t('adminHomeAvailabilityTitle')}
      description={t('adminHomeAvailabilityDescription')}
      action={
        <div className="flex items-center gap-2">
          <OwnerFilter
            size="sm"
            value={owners}
            onChange={(next) => {
              setOwners(next)
              setPage(1)
            }}
            className="w-36 sm:w-44"
          />
          <Badge tone="info">{t('adminHomeNow')}</Badge>
        </div>
      }
      loading={firstLoad}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-64 w-full"
    >
      <SearchInput
        value={input}
        onValueChange={setInput}
        placeholder={t('adminHomeSearchType')}
        aria-label={t('adminHomeSearchType')}
        className="max-w-xs"
      />
      <div
        aria-busy={refreshing || undefined}
        className={
          refreshing
            ? 'min-w-0 opacity-60 transition-opacity'
            : 'min-w-0 transition-opacity'
        }
      >
        <DataTable
          size="lg"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.type}
          loadingRows={6}
          empty={search ? t('adminHomeNoTypeMatch') : t('adminHomeNoTypes')}
          caption={t('adminHomeAvailabilityTitle')}
        />
        {refreshing && <span className="sr-only">{t('loading')}</span>}
      </div>
      {total > 0 && (
        <DataListPagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPage={setPage}
        />
      )}
    </AdminHomeSection>
  )
}
