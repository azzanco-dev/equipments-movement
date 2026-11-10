import { useState } from 'react'
import { AppLink, Tabs, TabsList, TabsTrigger } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import {
  availableEquipmentHref,
  insideProjectsLogHref,
  openWorkshopVisitsHref,
  ownerEquipmentHref,
} from '@/lib/adminHomeLinks'
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
import { OwnerTableSkeleton } from './HomeSkeletons'
import type { AdminHomeSectionState } from './useAdminHomeSection'

/** The light chart shade of each state (the approved v2 mockup's). */
export const STATE_SHADE: Record<FleetStateId, number> = {
  inside_site: 1,
  workshop_maintenance: 2,
  workshop_parking: 3,
  workshop_out_of_service: 5,
  workshop_unclassified: 4,
  available: 6,
}

/** One tone per owner (the chart outline shades, as the owner cards had). */
const OWNER_STROKE: Record<AdminHomeOwner, string> = {
  alazani: 'var(--chart-stroke-1)',
  takween: 'var(--chart-stroke-3)',
  third_party_f: 'var(--chart-stroke-2)',
  third_party_partnership_b: 'var(--chart-stroke-5)',
  external_supplier: 'var(--chart-stroke-4)',
}

const WORKSHOP_STATES = [
  'workshop_maintenance',
  'workshop_parking',
  'workshop_out_of_service',
  'workshop_unclassified',
] as const

export type FleetTab = 'fleet' | 'projects' | 'workshop' | 'available'

/** The four tabs in order, each with its label and the states it sums. */
export const FLEET_TABS: readonly {
  id: FleetTab
  label: TranslationKey
  states: readonly string[]
}[] = [
  { id: 'fleet', label: 'homeV2TabFleetTotal', states: FLEET_STATES },
  { id: 'projects', label: 'homeV2OnProjects', states: ['inside_site'] },
  { id: 'workshop', label: 'homeV2TabWorkshop', states: WORKSHOP_STATES },
  { id: 'available', label: 'equipmentStateAvailable', states: ['available'] },
]

/**
 * «حالة الاسطول» (owner 2026-11-09, the v2 mockup). Since the owner's review
 * of 2026-11-10 («بالنسبة للاسطول يكون فيه تابين، اول تاب اجمالي الاسطول حسب
 * الملاك، والثاني داخل المشاريع حسب الملاك برضه، وثاني جدول الورشة، وثالث
 * جدول المتاحة») it is four tabs, each a table of the five owners over the
 * page's ONE snapshot (no request of its own, no owner filter, no donut):
 * the fleet, on projects, the workshop (its four purposes summed) and
 * available — every owner's count with its share of the tab's total, the
 * total in the tab and in the last row. A count links to that owner's rows:
 * the equipment list (fleet, available) or the log's open visits (projects,
 * workshop), when the shell opens the page. An owner without units shows 0.
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
  const { t } = useI18n()
  const [tab, setTab] = useState<FleetTab>('fleet')
  const data = matrix.data
  const totals = data
    ? (Object.fromEntries(
        FLEET_TABS.map((item) => [item.id, ownerTotals(data, item.states)]),
      ) as Record<FleetTab, ReturnType<typeof ownerTotals>>)
    : null
  const current = totals ? totals[tab] : null
  const label =
    FLEET_TABS.find((item) => item.id === tab)?.label ?? 'homeV2FleetStatus'

  const hrefOf = (owner: AdminHomeOwner): string | null => {
    if (tab === 'fleet')
      return canOpenEquipment ? ownerEquipmentHref(owner) : null
    if (tab === 'projects')
      return canOpenLogs ? insideProjectsLogHref(owner) : null
    if (tab === 'workshop')
      return canOpenLogs ? openWorkshopVisitsHref([owner]) : null
    return canOpenEquipment ? availableEquipmentHref([owner]) : null
  }

  return (
    <HomeBlock
      title="homeV2FleetStatus"
      state={matrix.failed ? 'failed' : !data ? 'loading' : 'ready'}
      onRetry={matrix.retry}
      skeleton={<OwnerTableSkeleton />}
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as FleetTab)}>
        <TabsList
          variant="segmented"
          aria-label={t('homeV2FleetStatus')}
          className="mb-1.5"
        >
          {FLEET_TABS.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className="!h-7 !px-2.5 text-xs"
            >
              {t(item.label)}
              {totals && (
                <span className="ms-1 tabular-nums text-muted">
                  {totals[item.id].total}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {current && (
        <table className="w-full text-sm">
          <caption className="sr-only">{t(label)}</caption>
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="pb-1 text-start font-normal">
                {t('adminHomeColOwner')}
              </th>
              <th scope="col" className="pb-1 text-end font-normal">
                {t('homeV2ColCount')}
              </th>
              <th scope="col" className="pb-1 text-end font-normal">
                {t('homeV2ColShare')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {current.owners.map((row) => {
              const href = hrefOf(row.owner)
              return (
                <tr key={row.owner}>
                  <th
                    scope="row"
                    className="py-1.5 text-start text-[13px] font-normal"
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
                  <td className="py-1.5 text-end">
                    {href ? (
                      <AppLink
                        href={href}
                        className="rounded font-semibold tabular-nums underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <CountUp value={row.count} />
                      </AppLink>
                    ) : (
                      <span className="font-semibold tabular-nums">
                        <CountUp value={row.count} />
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-end text-xs tabular-nums text-muted">
                    {sharePercent(row.count, current.total)}%
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t">
              <th
                scope="row"
                className="pt-1.5 text-start text-[13px] font-semibold"
              >
                {t('homeV2Total')}
              </th>
              <td className="pt-1.5 text-end font-semibold tabular-nums">
                <CountUp value={current.total} />
              </td>
              <td className="pt-1.5 text-end text-xs tabular-nums text-muted">
                {current.total > 0 ? '100%' : '0%'}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </HomeBlock>
  )
}
