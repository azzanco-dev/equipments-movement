import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { FileSpreadsheet } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  DataTable,
  MiniTable,
  MiniTableGrid,
  SectionHeader,
  Tabs,
  TabsList,
  TabsTrigger,
  WorkshopPurposeBadge,
  cn,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { formatDate } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import {
  fetchFleetEquipment,
  fetchLatestEntries,
  fetchLatestEquipment,
  fetchMovementRecorderNames,
} from '@/lib/adminHomeData'
import {
  collectAllPages,
  FLEET_EXPORT_FILE_NAMES,
  fleetEquipmentExcelColumns,
  latestEntriesExcelColumns,
  latestEntryCompany,
  latestEquipmentExcelColumns,
  type FleetExportLabels,
} from '@/lib/adminHomeExport'
import {
  ADMIN_HOME_PAGE_SIZE,
  clampPage,
  FLEET_MINI_ROWS,
  fleetMiniTableDomId,
  normalizeWorkshopPurposeFilter,
  WORKSHOP_PURPOSE_FILTERS,
  type AdminHomeOwner,
  type AdminHomePage,
  type FleetEquipmentRow,
  type FleetJumpTarget,
  type FleetMiniTableId,
  type LatestEntryRow,
  type LatestEquipmentRow,
  type WorkshopPurposeFilter,
} from '@/lib/adminHomeStats'
import type { ExcelColumn } from '@/lib/excel'
import { useOwnerLabel } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

/** How long a card jump keeps its target table highlighted. */
const HIGHLIGHT_MS = 1500

/** An available unit; `foreman` is filled only for the expanded table. */
type AvailableRow = FleetEquipmentRow & { foreman?: string | null }

const PURPOSE_LABEL: Record<WorkshopPurposeFilter, TranslationKey> = {
  all: 'all',
  maintenance: 'adminHomeMaintenance',
  parking: 'adminHomeParking',
  unclassified: 'adminHomeUnclassified',
}

/**
 * A card jump. `seq` changes on every click, so clicking the same card twice
 * scrolls and highlights again.
 */
export interface FleetJumpRequest extends FleetJumpTarget {
  seq: number
}

/** One page of a mini table. `count` is true for the expanded form and the
 *  export, which need the total behind the pagination. */
type LoadPage<Row> = (
  page: number,
  pageSize: number,
  count: boolean,
  signal: AbortSignal,
) => Promise<AdminHomePage<Row>>

interface FleetTableProps<Row> {
  table: FleetMiniTableId
  title: string
  description: string
  /** Columns of the 7-row card. */
  columns: DataTableColumn<Row>[]
  /** Columns of the expanded table; the card's plus what it leaves out. */
  expandedColumns: DataTableColumn<Row>[]
  /** Memoized by the caller; it captures the filters. */
  loadPage: LoadPage<Row>
  /** Changes whenever the filters do, which sends the table back to page 1. */
  filterKey: string
  rowKey: (row: Row) => string
  onRowClick?: (row: Row) => void
  empty: string
  toolbar?: ReactNode
  highlighted: boolean
  /** Adds the database's total to the description (the state tables, whose
   *  total is `count(*) OVER ()` and costs nothing extra). */
  showCount?: boolean
  excelColumns: (labels: FleetExportLabels) => ExcelColumn<Row>[]
}

/**
 * One mini table, in its two forms.
 *
 * Collapsed, it is the shared `MiniTable` with 7 rows and «عرض الكل».
 * Expanded — in place, spanning the whole grid row — it is a full `DataTable`
 * with the database's pagination (20 per page), an Excel export of the whole
 * current filter, and «تصغير» to go back. Both forms read the same loader, so
 * they can never disagree about the filter.
 */
function FleetTable<Row>({
  table,
  title,
  description,
  columns,
  expandedColumns,
  loadPage,
  filterKey,
  rowKey,
  onRowClick,
  empty,
  toolbar,
  highlighted,
  showCount = false,
  excelColumns,
}: FleetTableProps<Row>) {
  const { t, lang } = useI18n()
  const ownerLabel = useOwnerLabel()
  const wrapper = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<'capped' | 'failed' | null>(null)

  // A filter change (owner, workshop chip) starts again from the first page.
  // Adjusted during render rather than in an effect, so a request for the
  // stale page is never sent.
  const [seenFilter, setSeenFilter] = useState(filterKey)
  if (seenFilter !== filterKey) {
    setSeenFilter(filterKey)
    setPage(1)
    setExportNote(null)
  }

  const pageSize = expanded ? ADMIN_HOME_PAGE_SIZE : FLEET_MINI_ROWS
  const load = useCallback(
    (signal: AbortSignal) =>
      loadPage(expanded ? page : 1, pageSize, expanded, signal),
    [loadPage, expanded, page, pageSize],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)
  const total = data?.total ?? 0

  // Keeps an expanded table on a page the database has rows for.
  useEffect(() => {
    if (!expanded || !data) return
    const safe = clampPage(page, data.total, ADMIN_HOME_PAGE_SIZE)
    if (safe !== page) setPage(safe)
  }, [data, expanded, page])

  const expand = () => {
    setExpanded(true)
    setPage(1)
  }

  const collapse = () => {
    setExpanded(false)
    setPage(1)
    setExportNote(null)
    // The expanded table can be far taller than the card; bring the card
    // back into view instead of leaving the reader below it.
    wrapper.current?.scrollIntoView({ block: 'nearest' })
  }

  const runExport = async () => {
    setExporting(true)
    setExportNote(null)
    const controller = new AbortController()
    try {
      // `xlsx` is only worth downloading once someone presses the button on
      // this landing page.
      const { exportRowsToExcel } = await import('@/lib/excel')
      const collected = await collectAllPages((exportPage, size) =>
        loadPage(exportPage, size, true, controller.signal),
      )
      exportRowsToExcel(
        title,
        excelColumns({ t, lang, ownerLabel }),
        collected.rows,
        { fileName: FLEET_EXPORT_FILE_NAMES[table], rtl: lang === 'ar' },
      )
      if (collected.capped) setExportNote('capped')
    } catch {
      // The loaders never surface a raw PostgreSQL message; this only decides
      // which translated line the table shows.
      setExportNote('failed')
    } finally {
      setExporting(false)
    }
  }

  const summary =
    showCount && data && !failed
      ? `${description} · ${t('adminHomeFleetCount').replace('{count}', String(total))}`
      : description

  // A failed load is shown as a failure with a retry, never as the empty
  // table.
  const error = failed ? (
    <span className="flex flex-wrap items-center gap-2">
      {t('adminHomeFleetTableError')}
      <Button size="sm" variant="outline" onClick={retry}>
        {t('retry')}
      </Button>
    </span>
  ) : undefined

  return (
    <div
      ref={wrapper}
      id={fleetMiniTableDomId(table)}
      role="region"
      aria-label={title}
      aria-busy={loading || undefined}
      // Focused by a card jump (never by Tab), so the ring below is the only
      // focus indicator it needs.
      tabIndex={-1}
      className={cn(
        'min-w-0 scroll-mt-20 rounded-xl outline-none transition-shadow duration-300',
        expanded && 'md:col-span-2 xl:col-span-3',
        highlighted && 'ring-2 ring-ring ring-offset-2 ring-offset-bg',
      )}
    >
      {expanded ? (
        <Card padded={false} className="flex min-w-0 flex-col">
          <div className="p-4 pb-0">
            <SectionHeader
              title={title}
              description={summary}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={exporting}
                    disabled={loading || failed || total === 0}
                    onClick={() => void runExport()}
                    icon={<FileSpreadsheet size={14} aria-hidden="true" />}
                  >
                    {t('exportExcel')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={collapse}>
                    {t('adminHomeCollapse')}
                  </Button>
                </div>
              }
            />
            {toolbar && <div className="mt-3">{toolbar}</div>}
          </div>
          <div className="space-y-3 p-4">
            <DataTable
              size="md"
              columns={expandedColumns}
              rows={data?.rows ?? []}
              rowKey={rowKey}
              // Only the first load shows skeleton rows; a page or filter
              // change keeps the rows on screen until the new page arrives.
              loading={loading && !data}
              loadingRows={6}
              error={error}
              empty={empty}
              caption={title}
              onRowClick={onRowClick}
            />
            <DataListPagination
              page={page}
              pageSize={ADMIN_HOME_PAGE_SIZE}
              total={total}
              onPage={setPage}
            />
            {exportNote && (
              <p
                className={
                  exportNote === 'failed'
                    ? 'text-xs text-danger'
                    : 'text-xs text-muted'
                }
                role={exportNote === 'failed' ? 'alert' : undefined}
              >
                {exportNote === 'failed'
                  ? t('adminHomeExportFailed')
                  : t('adminHomeExportCapped')}
              </p>
            )}
          </div>
        </Card>
      ) : (
        <MiniTable
          className="h-full"
          title={title}
          description={summary}
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={rowKey}
          maxRows={FLEET_MINI_ROWS}
          onViewAll={expand}
          toolbar={toolbar}
          loading={loading && !data}
          error={error}
          empty={empty}
          onRowClick={onRowClick}
        />
      )}
    </div>
  )
}

export interface FleetMiniTablesProps {
  /** The fleet state section's owner filter; it reaches every table. */
  owners: AdminHomeOwner[]
  /** The latest state-card click, or `null` before the first one. */
  jump: FleetJumpRequest | null
  onSelectEquipment?: (id: string) => void
}

/**
 * The mini tables under the fleet state cards (owner-approved design,
 * 2026-09-30): inside sites, in the workshop (with purpose chips), available,
 * the latest entries and the latest added equipment. Three across on desktop,
 * one on a phone.
 *
 * Everything is server-side: the three state tables read
 * `get_admin_fleet_equipment` (migration 0107), the latest entries read
 * `movement_log_search` and the latest equipment reads `equipment`, each
 * limited to 7 rows collapsed and paginated by 20 expanded. Every table loads
 * on its own and shows its own failure, so one broken table never blanks the
 * others or the cards above them.
 */
export function FleetMiniTables({
  owners,
  jump,
  onSelectEquipment,
}: FleetMiniTablesProps) {
  const { t, lang } = useI18n()
  const router = useRouter()
  const ownerLabel = useOwnerLabel()
  const [purpose, setPurpose] = useState<WorkshopPurposeFilter>('all')
  const [highlighted, setHighlighted] = useState<FleetMiniTableId | null>(null)

  // A card jump: select the chip, scroll to the table, and highlight it
  // briefly. Focus moves to the table too, so keyboard and screen-reader users
  // land where the click sent them.
  useEffect(() => {
    if (!jump) return
    if (jump.table === 'workshop') setPurpose(jump.purpose ?? 'all')
    setHighlighted(jump.table)
    const element = document.getElementById(fleetMiniTableDomId(jump.table))
    if (element) {
      const reduceMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      element.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      })
      element.focus({ preventScroll: true })
    }
    const timer = window.setTimeout(() => setHighlighted(null), HIGHLIGHT_MS)
    return () => window.clearTimeout(timer)
  }, [jump])

  const ownersKey = owners.join(',')

  const loadInside = useCallback<LoadPage<FleetEquipmentRow>>(
    (page, pageSize, _count, signal) =>
      fetchFleetEquipment(
        { state: 'inside_site', owners, page, pageSize },
        signal,
      ),
    [owners],
  )
  const loadWorkshop = useCallback<LoadPage<FleetEquipmentRow>>(
    (page, pageSize, _count, signal) =>
      fetchFleetEquipment(
        { state: 'workshop', purpose, owners, page, pageSize },
        signal,
      ),
    [owners, purpose],
  )
  // The foreman is only shown in the expanded table (`count` is true there and
  // for the export; the export's pages are bigger than a table page), so the
  // compact card and the export never pay for the extra lookup.
  const loadAvailable = useCallback<LoadPage<AvailableRow>>(
    async (page, pageSize, count, signal) => {
      const result = await fetchFleetEquipment(
        { state: 'available', owners, page, pageSize },
        signal,
      )
      if (!count || pageSize !== ADMIN_HOME_PAGE_SIZE) return result
      // Only a site exit carries a foreman; a workshop exit has none.
      const siteExitIds = result.rows
        .filter(
          (row) =>
            row.lastMovementContext === 'site' &&
            row.lastMovementType === 'exit' &&
            row.lastMovementId,
        )
        .map((row) => row.lastMovementId as string)
      const names = await fetchMovementRecorderNames(siteExitIds, signal)
      return {
        ...result,
        rows: result.rows.map((row) => ({
          ...row,
          foreman:
            row.lastMovementId && siteExitIds.includes(row.lastMovementId)
              ? (names.get(row.lastMovementId) ?? null)
              : null,
        })),
      }
    },
    [owners],
  )
  const loadEntries = useCallback<LoadPage<LatestEntryRow>>(
    (page, pageSize, count, signal) =>
      fetchLatestEntries({ owners, page, pageSize, count }, signal),
    [owners],
  )
  const loadAdded = useCallback<LoadPage<LatestEquipmentRow>>(
    (page, pageSize, count, signal) =>
      fetchLatestEquipment({ owners, page, pageSize, count }, signal),
    [owners],
  )

  const openEquipment = onSelectEquipment
    ? (row: { id: string }) => onSelectEquipment(row.id)
    : undefined

  const date = (value: string | null) => (
    <span className="text-muted">{value ? formatDate(value) : '—'}</span>
  )

  // --- shared columns -----------------------------------------------------
  const codeColumn: DataTableColumn<FleetEquipmentRow> = {
    key: 'code',
    header: t('adminHomeColEquipment'),
    cell: (row) => <span className="font-semibold">{row.code}</span>,
  }
  const sinceColumn: DataTableColumn<FleetEquipmentRow> = {
    key: 'since',
    header: t('adminHomeColSince'),
    align: 'end',
    width: '6.5rem',
    cell: (row) => date(row.since),
  }
  const typeColumn: DataTableColumn<FleetEquipmentRow> = {
    key: 'type',
    header: t('adminHomeColType'),
    hideBelow: 'sm',
    cell: (row) => row.type,
  }
  const ownerColumn: DataTableColumn<FleetEquipmentRow> = {
    key: 'owner',
    header: t('adminHomeColOwner'),
    hideBelow: 'md',
    cell: (row) => ownerLabel(row.owner),
  }

  // --- 1. inside sites ----------------------------------------------------
  const companyProjectColumn: DataTableColumn<FleetEquipmentRow> = {
    key: 'companyProject',
    header: t('adminHomeColCompanyProject'),
    cell: (row) => {
      const hasCompany = Boolean(row.companyNameAr || row.companyNameEn)
      const hasProject = Boolean(row.projectNameAr || row.projectNameEn)
      if (!hasCompany && !hasProject)
        return <span className="text-muted">—</span>
      return (
        <span>
          <span className="block">
            {hasCompany
              ? localizedName(lang, row.companyNameAr, row.companyNameEn)
              : '—'}
          </span>
          {hasProject && (
            <span className="block text-xs text-muted">
              {localizedName(lang, row.projectNameAr, row.projectNameEn)}
            </span>
          )}
        </span>
      )
    },
  }
  const insideColumns = [codeColumn, companyProjectColumn, sinceColumn]

  // --- 2. in the workshop -------------------------------------------------
  const purposeColumn: DataTableColumn<FleetEquipmentRow> = {
    key: 'purpose',
    header: t('adminHomeColPurpose'),
    cell: (row) =>
      row.workshopPurpose ? (
        <WorkshopPurposeBadge purpose={row.workshopPurpose} />
      ) : (
        <Badge tone="neutral">{t('adminHomeUnclassified')}</Badge>
      ),
  }
  const workshopColumns = [codeColumn, purposeColumn, sinceColumn]
  const purposeChips = (
    <Tabs
      value={purpose}
      onValueChange={(value) =>
        setPurpose(normalizeWorkshopPurposeFilter(value))
      }
    >
      <TabsList variant="segmented" aria-label={t('adminHomePurposeFilter')}>
        {WORKSHOP_PURPOSE_FILTERS.map((value) => (
          // The small size of the segmented control: 28 px, like the other
          // toolbar controls in a card header.
          <TabsTrigger
            key={value}
            value={value}
            className="!h-7 !px-2.5 text-xs"
          >
            {t(PURPOSE_LABEL[value])}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )

  // --- 3. available -------------------------------------------------------
  const lastExitColumn: DataTableColumn<FleetEquipmentRow> = {
    key: 'lastExit',
    header: t('adminHomeColLastExit'),
    align: 'end',
    width: '6.5rem',
    cell: (row) =>
      row.since ? (
        <span className="text-muted">{formatDate(row.since)}</span>
      ) : (
        // Neutral, not danger: never having moved is a data state here, not
        // an alarm.
        <Badge tone="neutral">{t('adminHomeNeverMoved')}</Badge>
      ),
  }
  const availableTypeColumn: DataTableColumn<FleetEquipmentRow> = {
    key: 'type',
    header: t('adminHomeColType'),
    cell: (row) => row.type,
  }
  const availableColumns = [codeColumn, availableTypeColumn, lastExitColumn]
  const availableForemanColumn: DataTableColumn<AvailableRow> = {
    key: 'foreman',
    header: t('adminHomeColForeman'),
    hideBelow: 'md',
    cell: (row) =>
      row.foreman ? row.foreman : <span className="text-muted">—</span>,
  }
  const availableCompanyProjectColumn: DataTableColumn<AvailableRow> = {
    ...companyProjectColumn,
    hideBelow: 'md',
  }

  // --- 4. latest entries --------------------------------------------------
  const entryColumns: DataTableColumn<LatestEntryRow>[] = [
    {
      key: 'code',
      header: t('adminHomeColEquipment'),
      cell: (row) => (
        <span className="font-semibold">{row.equipmentCode || '—'}</span>
      ),
    },
    {
      key: 'company',
      header: t('company'),
      cell: (row) =>
        row.context === 'workshop' ? (
          <span className="text-muted">{t('workshopContext')}</span>
        ) : (
          latestEntryCompany(row, lang, t) || '—'
        ),
    },
    {
      key: 'foreman',
      header: t('adminHomeColForeman'),
      cell: (row) => row.foreman ?? t('adminHomeUnknown'),
    },
    {
      key: 'date',
      header: t('adminHomeColMovementDate'),
      align: 'end',
      width: '6.5rem',
      cell: (row) => date(row.recordedAt),
    },
  ]
  const entryExpandedColumns: DataTableColumn<LatestEntryRow>[] = [
    ...entryColumns.slice(0, 3),
    {
      key: 'type',
      header: t('adminHomeColType'),
      hideBelow: 'md',
      cell: (row) => row.equipmentType,
    },
    {
      key: 'owner',
      header: t('adminHomeColOwner'),
      hideBelow: 'lg',
      cell: (row) => ownerLabel(row.owner),
    },
    entryColumns[3],
  ]

  // --- 5. latest added equipment ------------------------------------------
  const addedColumns: DataTableColumn<LatestEquipmentRow>[] = [
    {
      key: 'code',
      header: t('adminHomeColEquipment'),
      cell: (row) => <span className="font-semibold">{row.code}</span>,
    },
    { key: 'type', header: t('adminHomeColType'), cell: (row) => row.type },
    {
      key: 'owner',
      header: t('adminHomeColOwner'),
      cell: (row) => ownerLabel(row.owner),
    },
    {
      key: 'added',
      header: t('adminHomeColAddedAt'),
      align: 'end',
      width: '6.5rem',
      cell: (row) => date(row.createdAt),
    },
  ]

  return (
    <MiniTableGrid>
      <FleetTable
        table="inside"
        title={t('adminHomeFleetInsideTitle')}
        description={t('adminHomeFleetInsideDescription')}
        columns={insideColumns}
        expandedColumns={[
          codeColumn,
          companyProjectColumn,
          typeColumn,
          ownerColumn,
          sinceColumn,
        ]}
        loadPage={loadInside}
        filterKey={ownersKey}
        rowKey={(row) => row.id}
        onRowClick={openEquipment}
        empty={t('adminHomeFleetInsideEmpty')}
        highlighted={highlighted === 'inside'}
        showCount
        excelColumns={(labels) => fleetEquipmentExcelColumns('inside', labels)}
      />
      <FleetTable
        table="workshop"
        title={t('adminHomeFleetWorkshopTitle')}
        description={t('adminHomeFleetWorkshopDescription')}
        columns={workshopColumns}
        expandedColumns={[
          codeColumn,
          purposeColumn,
          typeColumn,
          ownerColumn,
          sinceColumn,
        ]}
        loadPage={loadWorkshop}
        filterKey={`${ownersKey}|${purpose}`}
        rowKey={(row) => row.id}
        onRowClick={openEquipment}
        empty={t('adminHomeFleetWorkshopEmpty')}
        toolbar={purposeChips}
        highlighted={highlighted === 'workshop'}
        showCount
        excelColumns={(labels) =>
          fleetEquipmentExcelColumns('workshop', labels)
        }
      />
      <FleetTable
        table="available"
        title={t('adminHomeAvailable')}
        description={t('adminHomeFleetAvailableDescription')}
        columns={availableColumns}
        expandedColumns={[
          codeColumn,
          availableTypeColumn,
          ownerColumn,
          availableCompanyProjectColumn,
          availableForemanColumn,
          lastExitColumn,
        ]}
        loadPage={loadAvailable}
        filterKey={ownersKey}
        rowKey={(row) => row.id}
        onRowClick={openEquipment}
        empty={t('adminHomeFleetAvailableEmpty')}
        highlighted={highlighted === 'available'}
        showCount
        excelColumns={(labels) =>
          fleetEquipmentExcelColumns('available', labels)
        }
      />
      <FleetTable
        table="entries"
        title={t('adminHomeFleetEntriesTitle')}
        description={t('adminHomeFleetEntriesDescription')}
        columns={entryColumns}
        expandedColumns={entryExpandedColumns}
        loadPage={loadEntries}
        filterKey={ownersKey}
        rowKey={(row) => row.id}
        // Both admin and monitor can open a movement's detail page.
        onRowClick={(row) => router.push(`/movements/${row.id}`)}
        empty={t('adminHomeFleetEntriesEmpty')}
        highlighted={highlighted === 'entries'}
        excelColumns={latestEntriesExcelColumns}
      />
      <FleetTable
        table="added"
        title={t('adminHomeFleetAddedTitle')}
        description={t('adminHomeFleetAddedDescription')}
        columns={addedColumns}
        expandedColumns={addedColumns}
        loadPage={loadAdded}
        filterKey={ownersKey}
        rowKey={(row) => row.id}
        onRowClick={openEquipment}
        empty={t('adminHomeFleetAddedEmpty')}
        highlighted={highlighted === 'added'}
        excelColumns={latestEquipmentExcelColumns}
      />
    </MiniTableGrid>
  )
}
