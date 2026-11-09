import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download } from 'lucide-react'
import { AppLink, Button, cn } from '@/components/ui'
import { SoftDonut } from '@/components/charts/lazy'
import type { FleetDonutSlice } from '@/components/charts/lazy'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  OUT_OF_SERVICE_LONG_DAYS,
  outOfServiceLongHref,
  saudiDayBefore,
} from '@/lib/adminAttention'
import {
  fetchAllOwnersStateMatrix,
  fetchLongOutOfServiceCount,
  fetchRestUnitsPage,
} from '@/lib/adminHomeData'
import {
  REST_EXPORT_PAGE_SIZE,
  collectAllPages,
  restUnitExcelColumns,
} from '@/lib/adminHomeExport'
import {
  availableEquipmentHref,
  openWorkshopVisitsHref,
} from '@/lib/adminHomeLinks'
import {
  FLEET_STATES,
  ownerTotals,
  type AdminHomeOwner,
} from '@/lib/adminHomeStats'
import { CountUp } from './CountUp'
import { STATE_SHADE } from './FleetStateCard'
import { HomeBlock, ViewAllAction } from './HomeBlock'
import { OwnerFilter, useOwnerLabel } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

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
 * purpose as a donut, the units «خارج الخدمة» for over 30 days, and the
 * available units. It took the place of «حالات المتبقي» (owner 2026-10-29)
 * and keeps its decisions: its own owner filter over all five, Al-Azani by
 * default («اضف له فلتر للملاك كلهم، وافتراضي على العزاني»; empty = every
 * owner), and the Excel export of the units outside a project — the workshop
 * and the available ones — for those owners («الاعمدة بيانات المعدة، تاريخ
 * الدخول، والحالة»). «عرض الكل» opens the log's open workshop visits of
 * those owners.
 */
export function WorkshopPurposeCard({
  canOpenLogs,
  canOpenEquipment,
}: {
  canOpenLogs: boolean
  canOpenEquipment: boolean
}) {
  const { t, lang, dir } = useI18n()
  const ownerLabel = useOwnerLabel()
  const [owners, setOwners] = useState<AdminHomeOwner[]>(['alazani'])
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<'failed' | 'capped' | null>(null)
  const cutoff = useMemo(
    () => saudiDayBefore(new Date(), OUT_OF_SERVICE_LONG_DAYS),
    [],
  )
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [matrix, longOutOfService] = await Promise.all([
        fetchAllOwnersStateMatrix(signal, owners),
        fetchLongOutOfServiceCount(cutoff, owners, signal),
      ])
      return { matrix, longOutOfService }
    },
    [cutoff, owners],
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
  const available = data ? ownerTotals(data.matrix, ['available']).total : 0
  const outside = data
    ? ownerTotals(
        data.matrix,
        FLEET_STATES.filter((state) => state !== 'inside_site'),
      ).total
    : 0
  const lineClass = 'flex items-center gap-1.5 text-sm text-muted'
  const longHref = canOpenLogs ? outOfServiceLongHref(cutoff, owners) : null
  const availableHref = canOpenEquipment ? availableEquipmentHref(owners) : null

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
          <ul className="mt-2 space-y-1 border-t pt-2">
            <li className={lineClass}>
              <AlertTriangle
                size={14}
                aria-hidden="true"
                className="shrink-0 text-danger"
              />
              {t('homeV2OutOfServiceLong')}
              <Figure value={data.longOutOfService} href={longHref} />
            </li>
            <li className={lineClass}>
              <CheckCircle2
                size={14}
                aria-hidden="true"
                className="shrink-0 text-success"
              />
              {t('homeV2AvailableOfOwners')}
              <Figure value={available} href={availableHref} />
            </li>
          </ul>
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

function Figure({ value, href }: { value: number; href: string | null }) {
  const body = (
    <span className="font-semibold tabular-nums text-fg">
      <CountUp value={value} />
    </span>
  )
  return href ? (
    <AppLink
      href={href}
      className="rounded underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {body}
    </AppLink>
  ) : (
    body
  )
}
