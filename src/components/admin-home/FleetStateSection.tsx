import { useCallback } from 'react'
import { Badge, StatCard } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { fetchFleetState } from '@/lib/adminHomeData'
import type { AdminHomeOwner } from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { useAdminHomeSection } from './useAdminHomeSection'

export interface FleetStateSectionProps {
  /** An empty array means every owner. */
  owners: AdminHomeOwner[]
}

/**
 * "الحالة الان": where the fleet is at this moment, assets first.
 *
 * The four state cards answer "where is my equipment" and get the room; the
 * no-movement breakdown is one smaller line underneath, because it is the
 * lead-in to the section that follows. Nothing here is period-scoped, so the
 * section carries the "now" chip and the chart's period switcher deliberately
 * does not reach it.
 */
export function FleetStateSection({ owners }: FleetStateSectionProps) {
  const { t } = useI18n()
  const load = useCallback(
    (signal: AbortSignal) => fetchFleetState(owners, signal),
    [owners],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const cards = [
    {
      id: 'sites',
      label: t('adminHomeInsideSites'),
      value: data?.insideSites ?? 0,
      hint: undefined as string | undefined,
    },
    {
      id: 'workshop',
      label: t('adminHomeInWorkshop'),
      value: data?.inWorkshop ?? 0,
      hint: data
        ? `${t('adminHomeMaintenance')} ${data.workshopMaintenance} · ${t(
            'adminHomeParking',
          )} ${data.workshopParking} · ${t('adminHomeUnclassified')} ${
            data.workshopUnclassified
          }`
        : undefined,
    },
    {
      id: 'available',
      label: t('adminHomeAvailable'),
      value: data?.available ?? 0,
      hint: undefined,
    },
    {
      id: 'idle',
      label: t('adminHomeIdle'),
      value: data?.idle90 ?? 0,
      hint: t('adminHomeIdleHint'),
    },
  ]

  const idleChips = data
    ? [
        { id: '30', label: `30+ ${t('adminHomeDayUnit')}`, value: data.idle30 },
        { id: '60', label: `60+ ${t('adminHomeDayUnit')}`, value: data.idle60 },
        { id: '90', label: `90+ ${t('adminHomeDayUnit')}`, value: data.idle90 },
        {
          id: 'never',
          label: t('adminHomeNoMovementEver'),
          value: data.neverMoved,
        },
      ]
    : []

  return (
    <AdminHomeSection
      title={t('adminHomeStateTitle')}
      description={t('adminHomeStateDescription')}
      action={<Badge tone="info">{t('adminHomeNow')}</Badge>}
      loading={loading}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-28 w-full"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.id}
            label={card.label}
            value={card.value}
            hint={card.hint}
            className="p-4"
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">
          {t('adminHomeIdleBreakdown')}
        </span>
        {idleChips.map((chip) => (
          <Badge
            key={chip.id}
            tone={chip.id === 'never' ? 'danger' : 'neutral'}
          >
            <span className="tabular-nums">
              {chip.label}: {chip.value}
            </span>
          </Badge>
        ))}
      </div>
      <p className="text-xs text-muted">{t('adminHomeIdleNested')}</p>
    </AdminHomeSection>
  )
}
