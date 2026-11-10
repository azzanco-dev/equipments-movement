import { useMemo, useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui'
import { SoftDonut } from '@/components/charts/lazy'
import type { FleetDonutSlice } from '@/components/charts/lazy'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { insideProjectsLogHref, ownerEquipmentHref } from '@/lib/adminHomeLinks'
import {
  FLEET_STATES,
  ownerTotals,
  type AdminHomeOwner,
  type FleetStateId,
  type OwnerStateMatrix,
} from '@/lib/adminHomeStats'
import { ownershipBadge } from '@/lib/equipmentForm'
import { HomeBlock } from './HomeBlock'
import { DonutSkeleton } from './HomeSkeletons'
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

/** One chart shade per owner (the tones the owner cards had). */
const OWNER_SHADE: Record<AdminHomeOwner, number> = {
  alazani: 1,
  takween: 3,
  third_party_f: 2,
  third_party_partnership_b: 5,
  external_supplier: 4,
}

export type FleetTab = 'fleet' | 'projects'

/** The two tabs in order, each with its label and the states it sums. */
export const FLEET_TABS: readonly {
  id: FleetTab
  label: TranslationKey
  states: readonly string[]
}[] = [
  { id: 'fleet', label: 'homeV2TabFleetTotal', states: FLEET_STATES },
  { id: 'projects', label: 'homeV2OnProjects', states: ['inside_site'] },
]

/**
 * «الاسطول» (owner 2026-11-09, the v2 mockup, as «حالة الاسطول»). Since the
 * owner's review of 2026-11-10 («بالنسبة للاسطول يكون فيه تابين، اول تاب
 * اجمالي الاسطول حسب الملاك، والثاني داخل المشاريع حسب الملاك برضه», then
 * «حالة الاسطول خليه دونات», then «خليها "الاسطول" وشيل منه تاب الورشة
 * والمتاحة») it is two tabs over the page's ONE snapshot (no request of its
 * own, no owner filter): «الاجمالي» and «في المشاريع», each a `SoftDonut` of
 * the five owners — a 230 px ring with the tab's total in the middle and the
 * owners under it in two columns with their count and share (owner the same
 * day, «لو كبرت الدونات وخليت النصوص تحت» → «الجديد»), an owner without
 * units 0. An owner's name links to
 * that owner's rows: the equipment list or the log's open project visits,
 * when the shell opens the page.
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
  const [tab, setTab] = useState<FleetTab>('fleet')
  const data = matrix.data
  const totals = useMemo(
    () =>
      data
        ? (Object.fromEntries(
            FLEET_TABS.map((item) => [item.id, ownerTotals(data, item.states)]),
          ) as Record<FleetTab, ReturnType<typeof ownerTotals>>)
        : null,
    [data],
  )
  const current = totals ? totals[tab] : null
  const label =
    FLEET_TABS.find((item) => item.id === tab)?.label ?? 'homeV2FleetStatus'

  const hrefOf = (owner: AdminHomeOwner): string | undefined =>
    tab === 'fleet'
      ? canOpenEquipment
        ? ownerEquipmentHref(owner)
        : undefined
      : canOpenLogs
        ? insideProjectsLogHref(owner)
        : undefined

  const slices: FleetDonutSlice[] = current
    ? current.owners.map((row) => ({
        id: row.owner,
        label: t(ownershipBadge(row.owner).key),
        value: row.count,
        color: `var(--chart-${OWNER_SHADE[row.owner]})`,
        strokeColor: `var(--chart-stroke-${OWNER_SHADE[row.owner]})`,
        href: hrefOf(row.owner),
      }))
    : []

  return (
    <HomeBlock
      title="homeV2FleetStatus"
      state={matrix.failed ? 'failed' : !data ? 'loading' : 'ready'}
      onRetry={matrix.retry}
      skeleton={<DonutSkeleton tabs legendRows={5} under />}
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
        <SoftDonut
          ariaLabel={`${t('homeV2FleetStatus')} · ${t(label)}`}
          dir={dir}
          lang={lang}
          centerLabel={t('adminHomeDonutTotal')}
          height={230}
          legend="under"
          slices={slices}
        />
      )}
    </HomeBlock>
  )
}
