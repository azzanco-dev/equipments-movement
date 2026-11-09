import { useCallback, useMemo, useState } from 'react'
import { AppLink, Tabs, TabsList, TabsTrigger } from '@/components/ui'
import { SoftDonut } from '@/components/charts/lazy'
import type { FleetDonutSlice } from '@/components/charts/lazy'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { fetchAllOwnersStateMatrix } from '@/lib/adminHomeData'
import { insideProjectsLogHref, ownerEquipmentHref } from '@/lib/adminHomeLinks'
import {
  FLEET_STATES,
  ownerTotals,
  type AdminHomeOwner,
  type FleetStateId,
  type OwnerStateMatrix,
} from '@/lib/adminHomeStats'
import { sharePercent } from '@/lib/adminHomeV2'
import { ownershipBadge } from '@/lib/equipmentForm'
import { CountUp } from './CountUp'
import { HomeBlock } from './HomeBlock'
import { DonutSkeleton } from './HomeSkeletons'
import { OwnerFilter } from './OwnerFilter'
import {
  useAdminHomeSection,
  type AdminHomeSectionState,
} from './useAdminHomeSection'

/** The light chart shade of each state (the approved v2 mockup's). */
export const STATE_SHADE: Record<FleetStateId, number> = {
  inside_site: 1,
  workshop_maintenance: 2,
  workshop_parking: 3,
  workshop_out_of_service: 5,
  workshop_unclassified: 4,
  available: 6,
}

const STATE_LABEL: Record<FleetStateId, TranslationKey> = {
  inside_site: 'homeV2OnProjects',
  workshop_maintenance: 'maintenancePurpose',
  workshop_parking: 'parkingPurpose',
  workshop_out_of_service: 'workshopPurposeOutOfService',
  workshop_unclassified: 'equipmentStateUnclassified',
  available: 'equipmentStateAvailable',
}

/** One tone per owner (the chart outline shades, as the owner cards had). */
const OWNER_STROKE: Record<AdminHomeOwner, string> = {
  alazani: 'var(--chart-stroke-1)',
  takween: 'var(--chart-stroke-3)',
  third_party_f: 'var(--chart-stroke-2)',
  third_party_partnership_b: 'var(--chart-stroke-5)',
  external_supplier: 'var(--chart-stroke-4)',
}

type View = 'state' | 'owner'

/**
 * «حالة الاسطول» (owner 2026-11-09, the v2 mockup): the fleet by state as a
 * donut with count and share, for the owners of its own filter (all five,
 * empty = every owner, the KPI strip's snapshot then). The «الملاك» tab keeps
 * what the owner boxes of 2026-10-29 showed: every owner's fleet and units
 * on projects, each a link to the equipment list of that owner or the log's
 * open project visits of that owner.
 */
export function FleetStateCard({
  matrix,
  canOpenEquipment,
  canOpenLogs,
}: {
  /** The page's snapshot over every owner (the KPI strip's). */
  matrix: AdminHomeSectionState<OwnerStateMatrix>
  canOpenEquipment: boolean
  canOpenLogs: boolean
}) {
  const { t, lang, dir } = useI18n()
  const [owners, setOwners] = useState<AdminHomeOwner[]>([])
  const [view, setView] = useState<View>('state')
  // Only a narrowed selection costs a request of its own.
  const load = useCallback(
    (signal: AbortSignal) =>
      owners.length
        ? fetchAllOwnersStateMatrix(signal, owners)
        : Promise.resolve(null),
    [owners],
  )
  const own = useAdminHomeSection(load)
  const source = owners.length ? own : matrix
  const data = owners.length ? own.data : matrix.data

  const slices: FleetDonutSlice[] = useMemo(
    () =>
      data
        ? FLEET_STATES.map((state) => ({
            id: state,
            label: t(STATE_LABEL[state]),
            value: ownerTotals(data, [state]).total,
            color: `var(--chart-${STATE_SHADE[state]})`,
            strokeColor: `var(--chart-stroke-${STATE_SHADE[state]})`,
          }))
        : [],
    [data, t],
  )

  // The owners tab always reads every owner (the page's snapshot).
  const fleet = matrix.data ? ownerTotals(matrix.data, FLEET_STATES) : null
  const sites = matrix.data ? ownerTotals(matrix.data, ['inside_site']) : null

  return (
    <HomeBlock
      title="homeV2FleetStatus"
      action={
        view === 'state' ? (
          <OwnerFilter
            size="sm"
            className="w-36"
            value={owners}
            onChange={setOwners}
          />
        ) : undefined
      }
      state={
        source.failed
          ? 'failed'
          : !data && (view === 'state' || !matrix.data)
            ? 'loading'
            : 'ready'
      }
      onRetry={source.retry}
      skeleton={<DonutSkeleton tabs legendRows={6} />}
    >
      <Tabs value={view} onValueChange={(value) => setView(value as View)}>
        <TabsList
          variant="segmented"
          aria-label={t('homeV2FleetStatus')}
          className="mb-2"
        >
          <TabsTrigger value="state" className="!h-7 !px-2.5 text-xs">
            {t('homeV2ByState')}
          </TabsTrigger>
          <TabsTrigger value="owner" className="!h-7 !px-2.5 text-xs">
            {t('homeV2ByOwner')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {view === 'state' ? (
        <div
          aria-busy={(own.loading && Boolean(own.data)) || undefined}
          className={own.loading && own.data ? 'opacity-60' : undefined}
        >
          <SoftDonut
            ariaLabel={t('homeV2FleetStatus')}
            dir={dir}
            lang={lang}
            centerLabel={t('adminHomeDonutTotal')}
            height={190}
            legend="side"
            slices={slices}
          />
        </div>
      ) : fleet && sites ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{t('homeV2ByOwner')}</caption>
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="pb-1 text-start font-normal">
                {t('adminHomeColOwner')}
              </th>
              <th scope="col" className="pb-1 text-end font-normal">
                {t('homeV2Fleet')}
              </th>
              <th scope="col" className="pb-1 text-end font-normal">
                {t('homeV2OnProjects')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {fleet.owners.map((row) => {
              const inside =
                sites.owners.find((site) => site.owner === row.owner)?.count ??
                0
              const cell = (value: number, href: string | null) =>
                href ? (
                  <AppLink
                    href={href}
                    className="rounded font-semibold tabular-nums underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <CountUp value={value} />
                  </AppLink>
                ) : (
                  <span className="font-semibold tabular-nums">
                    <CountUp value={value} />
                  </span>
                )
              return (
                <tr key={row.owner}>
                  <th
                    scope="row"
                    className="py-2 text-start text-[13px] font-normal"
                  >
                    <span className="flex items-start gap-1.5">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: OWNER_STROKE[row.owner] }}
                      />
                      {t(ownershipBadge(row.owner).key)}
                    </span>
                  </th>
                  <td className="py-2 text-end">
                    {cell(
                      row.count,
                      canOpenEquipment ? ownerEquipmentHref(row.owner) : null,
                    )}
                    <span className="ms-1.5 text-xs tabular-nums text-muted">
                      {sharePercent(row.count, fleet.total)}%
                    </span>
                  </td>
                  <td className="py-2 text-end">
                    {cell(
                      inside,
                      canOpenLogs ? insideProjectsLogHref(row.owner) : null,
                    )}
                    <span className="ms-1.5 text-xs tabular-nums text-muted">
                      {sharePercent(inside, sites.total)}%
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}
    </HomeBlock>
  )
}
