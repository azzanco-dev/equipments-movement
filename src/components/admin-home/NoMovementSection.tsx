import { useCallback, useEffect, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { Badge, Button, DataTable } from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { fetchOutsideEquipment } from '@/lib/adminHomeData'
import {
  ADMIN_HOME_PAGE_SIZE,
  clampPage,
  type AdminHomeOwner,
  type OutsideEquipmentRow,
} from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { OwnerFilter, useOwnerLabel } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

export interface NoMovementSectionProps {
  onSelectEquipment?: (id: string) => void
}

/**
 * "معدات بلا حركة": the equipment that is outside right now.
 *
 * Owner review (2026-09-22, third pass) redefined this section. It is no
 * longer an idle-time report: a long idle time is normal for this fleet and
 * says nothing on its own, so the 30/60/90-day threshold, the days column and
 * the red rows are gone. What is left is the operational question — which
 * units are neither inside a site nor in the workshop, i.e. their latest
 * movement across both contexts is an EXIT, or they have never moved at all —
 * ordered by the most recent exit first, with never-moved units at the end.
 *
 * Everything that bounds the table is the database's (migration 0101): the
 * filter, the order, the page of 20 and the total behind the pagination. The
 * Excel export follows the current filter across every page, walking the same
 * function in pages of 500 up to a hard cap, so pressing it can never pull an
 * unbounded list into the browser — and when the cap does truncate the file,
 * the section says so instead of handing over a silently short export.
 */
export function NoMovementSection({
  onSelectEquipment,
}: NoMovementSectionProps) {
  const { t, lang } = useI18n()
  const ownerLabel = useOwnerLabel()
  // Per-section state, deliberately not in the URL: the owner asked for a
  // filter that reflects on this table only.
  const [owners, setOwners] = useState<AdminHomeOwner[]>([])
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<'capped' | 'failed' | null>(null)

  const load = useCallback(
    (signal: AbortSignal) =>
      fetchOutsideEquipment(
        { owners, page, pageSize: ADMIN_HOME_PAGE_SIZE },
        signal,
      ),
    [owners, page],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const total = data?.total ?? 0
  // A filter that shrinks the result while a later page is open would leave
  // the table on a page the database has no rows for, which reads as "there is
  // nothing here" rather than as the end of the list.
  useEffect(() => {
    if (!data) return
    const safe = clampPage(page, data.total, ADMIN_HOME_PAGE_SIZE)
    if (safe !== page) setPage(safe)
  }, [data, page])

  const changeOwners = (next: AdminHomeOwner[]) => {
    setOwners(next)
    setPage(1)
    setExportNote(null)
  }

  const runExport = async () => {
    setExporting(true)
    setExportNote(null)
    const controller = new AbortController()
    try {
      // Dynamically imported: `xlsx` is only worth downloading once someone
      // actually presses the button on this landing page.
      const { collectAllPages, exportOutsideEquipmentToExcel } =
        await import('@/lib/adminHomeExport')
      const collected = await collectAllPages((exportPage, pageSize) =>
        fetchOutsideEquipment(
          { owners, page: exportPage, pageSize },
          controller.signal,
        ),
      )
      await exportOutsideEquipmentToExcel(collected.rows, {
        t,
        lang,
        ownerLabel,
      })
      if (collected.capped) setExportNote('capped')
    } catch {
      // The loaders never surface a raw PostgreSQL message; this only decides
      // which translated line the section shows.
      setExportNote('failed')
    } finally {
      setExporting(false)
    }
  }

  const columns: DataTableColumn<OutsideEquipmentRow>[] = [
    {
      key: 'code',
      header: t('adminHomeColEquipment'),
      width: '7rem',
      cell: (row) => <span className="font-semibold">{row.code}</span>,
    },
    {
      key: 'type',
      header: t('adminHomeColType'),
      hideBelow: 'sm',
      cell: (row) => row.type,
    },
    {
      key: 'owner',
      header: t('adminHomeColOwner'),
      hideBelow: 'md',
      cell: (row) => ownerLabel(row.owner),
    },
    {
      key: 'last',
      header: t('adminHomeColLastMovement'),
      cell: (row) =>
        row.lastMovementAt ? (
          <span className="text-muted">{formatDate(row.lastMovementAt)}</span>
        ) : (
          // Neutral, not danger: never having moved is a data state here, not
          // an alarm.
          <Badge tone="neutral">{t('adminHomeNeverMoved')}</Badge>
        ),
    },
  ]

  return (
    <AdminHomeSection
      title={t('adminHomeNoMovementTitle')}
      description={t('adminHomeOutsideDescription')}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <OwnerFilter
            size="sm"
            className="w-44"
            value={owners}
            onChange={changeOwners}
          />
          <Button
            size="sm"
            variant="outline"
            loading={exporting}
            disabled={loading || total === 0}
            onClick={() => void runExport()}
            icon={<FileSpreadsheet size={14} aria-hidden="true" />}
          >
            {t('exportExcel')}
          </Button>
        </div>
      }
      // Only the first load replaces the section with a skeleton; a page or a
      // filter change keeps the rows on screen until the new page arrives.
      loading={loading && !data}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-64 w-full"
    >
      <div aria-busy={loading || undefined} className="space-y-3">
        <DataTable
          size="lg"
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.id}
          loadingRows={6}
          empty={t('adminHomeOutsideEmpty')}
          caption={t('adminHomeNoMovementTitle')}
          onRowClick={
            onSelectEquipment ? (row) => onSelectEquipment(row.id) : undefined
          }
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
    </AdminHomeSection>
  )
}
