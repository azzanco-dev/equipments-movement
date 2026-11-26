import { useCallback, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { AppLink, Button, cn } from '@/components/ui'
import { SoftDonut } from '@/components/charts/lazy'
import type { FleetDonutSlice } from '@/components/charts/lazy'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { percentOf } from '@/components/charts/chartShared'
import { fetchAllOwnersStateMatrix, fetchRestUnitsPage } from '@/lib/adminHomeData'
import {
  REST_EXPORT_PAGE_SIZE,
  collectAllPages,
  restUnitExcelColumns,
} from '@/lib/adminHomeExport'
import { openWorkshopVisitsHref } from '@/lib/adminHomeLinks'
import {
  FLEET_STATES,
  ownerTotals,
  type AdminHomeOwner,
  type OwnerStateMatrix,
} from '@/lib/adminHomeStats'
import { ownershipBadge } from '@/lib/equipmentForm'
import { CountUp } from './CountUp'
import { OWNER_SHADE, STATE_SHADE } from './FleetStateCard'
import { HomeBlock, ViewAllAction } from './HomeBlock'
import { DonutSkeleton } from './HomeSkeletons'
import { OwnerFilter, useOwnerLabel } from './OwnerFilter'
import {
  useAdminHomeSection,
  type AdminHomeSectionState,
} from './useAdminHomeSection'

const PURPOSES: {
  state: (typeof FLEET_STATES)[number]
  label: TranslationKey
}[] = [
  { state: 'workshop_maintenance', label: 'maintenancePurpose' },
  { state: 'workshop_parking', label: 'parkingPurpose' },
  { state: 'workshop_out_of_service', label: 'workshopPurposeOutOfService' },
  { state: 'workshop_unclassified', label: 'equipmentStateUnclassified' },
]

/**
 * «الورشة حسب الغرض» (owner 2026-11-09, the v2 mockup): the workshop by
 * purpose as a donut and, under it, the units in the workshop BY OWNER in
 * two columns like the fleet card, without «مالك اخر» (owner 2026-11-26,
 * «المساحة الي تحت خليها مثل الاسطول, بالملاك تصير», his choice «قائمة
 * الملاك تحت الدائرة … بدون المالك الاخر»; the lines «خارج الخدمة اكثر من
 * 30 يوم» and «متاحة للملاك المختارين» it replaced are gone). The owners
 * list reads the page's snapshot over every owner, so it does not follow the
 * card's owner filter; the ring does. It took the place of «حالات المتبقي» (owner 2026-10-29)
 * and keeps its decisions: its own owner filter over all five, Al-Azani by
 * default («اضف له فلتر للملاك كلهم، وافتراضي على العزاني»; empty = every
 * owner), and the Excel export of the units outside a project — the workshop
 * and the available ones — for those owners («الاعمدة بيانات المعدة، تاريخ
 * الدخول، والحالة»). «عرض الكل» opens the log's open workshop visits of
 * those owners.
 */
export function WorkshopPurposeCard({
  matrix: pageMatrix,
  canOpenLogs,
}: {
  /** The page's snapshot over every owner, for the owners list. */
  matrix: AdminHomeSectionState<OwnerStateMatrix>
  canOpenLogs: boolean
}) {
  const { t, lang, dir } = useI18n()
  const ownerLabel = useOwnerLabel()
  const [owners, setOwners] = useState<AdminHomeOwner[]>(['alazani'])
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<'failed' | 'capped' | null>(null)
  const load = useCallback(
    async (signal: AbortSignal) => ({
      matrix: await fetchAllOwnersStateMatrix(signal, owners),
    }),
    [owners],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const runExport = async () => {
    setExporting(true)
    setExportNote(null)
    const controller = new AbortController()
    try {
      const [{ exportRowsToExcel }, collected] = await Promise.all([
        import('@/lib/excel'),
        collectAllPages(
          (page, size) =>
            fetchRestUnitsPage(owners, page, size, controller.signal),
          { pageSize: REST_EXPORT_PAGE_SIZE },
        ),
      ])
      exportRowsToExcel(
        t('adminHomeRestStatesTitle'),
        restUnitExcelColumns({ t, lang, ownerLabel }),
        collected.rows,
        { fileName: 'remaining-by-state', rtl: lang === 'ar' },
      )
      if (collected.capped) setExportNote('capped')
    } catch {
      setExportNote('failed')
    } finally {
      setExporting(false)
    }
  }

  const slices: FleetDonutSlice[] = useMemo(
    () =>
      data
        ? PURPOSES.map((item) => ({
            id: item.state,
            label: t(item.label),
            value: ownerTotals(data.matrix, [item.state]).total,
            color: `var(--chart-${STATE_SHADE[item.state]})`,
            strokeColor: `var(--chart-stroke-${STATE_SHADE[item.state]})`,
          }))
        : [],
    [data, t],
  )
  const ownerRows = useMemo(() => {
    if (!pageMatrix.data) return null
    const rows = ownerTotals(
      pageMatrix.data,
      PURPOSES.map((item) => item.state),
    ).owners.filter((row) => row.owner !== 'external_supplier')
    return {
      rows,
      total: rows.reduce((sum, row) => sum + row.count, 0),
    }
  }, [pageMatrix.data])
  const outside = data
    ? ownerTotals(
        data.matrix,
        FLEET_STATES.filter((state) => state !== 'inside_site'),
      ).total
    : 0

  return (
    <HomeBlock
      title="homeV2WorkshopByPurpose"
      action={
        <>
          <OwnerFilter
            size="sm"
            className="w-32"
            value={owners}
            onChange={setOwners}
          />
          <ViewAllAction
            href={canOpenLogs ? openWorkshopVisitsHref(owners) : null}
          />
        </>
      }
      state={failed ? 'failed' : loading && !data ? 'loading' : 'ready'}
      onRetry={retry}
      skeleton={<DonutSkeleton footerRows={2} footerButton />}
    >
      {data && (
        <div
          aria-busy={loading || undefined}
          className={cn(loading && 'opacity-60')}
        >
          <SoftDonut
            ariaLabel={t('homeV2WorkshopByPurpose')}
            dir={dir}
            lang={lang}
            centerLabel={t('homeV2InWorkshop')}
            height={190}
            legend="side"
            slices={slices}
          />
          {ownerRows && (
            <ul
              aria-label={t('homeV2WorkshopByOwner')}
              className="mt-2 grid grid-cols-2 gap-x-3 border-t pt-2 text-xs"
            >
              {ownerRows.rows.map((row) => (
                <OwnerLine
                  key={row.owner}
                  owner={row.owner}
                  label={t(ownershipBadge(row.owner).key)}
                  count={row.count}
                  share={percentOf(row.count, ownerRows.total)}
                  href={
                    canOpenLogs ? openWorkshopVisitsHref([row.owner]) : null
                  }
                />
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              loading={exporting}
              disabled={outside === 0}
              icon={<Download size={14} aria-hidden="true" />}
              onClick={() => void runExport()}
            >
              {t('exportExcel')}
            </Button>
            {exportNote && (
              <span
                role={exportNote === 'failed' ? 'alert' : undefined}
                className={cn(
                  'text-xs',
                  exportNote === 'failed' ? 'text-danger' : 'text-muted',
                )}
              >
                {exportNote === 'failed'
                  ? t('adminHomeExportFailed')
                  : t('adminHomeExportCapped')}
              </span>
            )}
          </div>
        </div>
      )}
    </HomeBlock>
  )
}

/** One owner under the ring, the fleet card's legend row. */
function OwnerLine({
  owner,
  label,
  count,
  share,
  href,
}: {
  owner: AdminHomeOwner
  label: string
  count: number
  share: number
  href: string | null
}) {
  return (
    <li className="flex items-center gap-2 py-1">
      <span
        aria-hidden="true"
        className="block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: `var(--chart-${OWNER_SHADE[owner]})` }}
      />
      {href ? (
        <AppLink
          href={href}
          className="truncate-safe min-w-0 flex-1 rounded text-fg underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {label}
        </AppLink>
      ) : (
        <span className="truncate-safe min-w-0 flex-1 text-fg">{label}</span>
      )}
      <span className="font-semibold tabular-nums text-fg">
        <CountUp value={count} />
      </span>
      <span className="w-9 text-end tabular-nums text-muted">{share}%</span>
    </li>
  )
}
