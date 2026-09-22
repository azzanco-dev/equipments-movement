import { useCallback, useState } from 'react'
import { Badge, StatCard } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import { fetchFleetState } from '@/lib/adminHomeData'
import type { AdminHomeOwner } from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { OwnerFilter } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

/**
 * "الحالة الان": where the fleet is at this moment.
 *
 * Owner review (2026-09-22):
 *   * the fleet total leads the section as a full-width card — it is the
 *     number every other number on the page is a share of;
 *   * the 30 / 60 / 90-day "no movement" line under the cards is gone. A long
 *     idle time is normal for this fleet, so an age is not a state, and the
 *     section that follows now answers the question that actually matters
 *     ("what is outside right now") instead;
 *   * the owner filter is the section's own, in the heading row, and reaches
 *     nothing else on the page.
 *
 * Nothing here is period-scoped, so the section carries the "now" chip and the
 * chart's granularity switch deliberately does not reach it.
 */
export function FleetStateSection() {
  const { t } = useI18n()
  // Plain component state, not the URL: it scopes this section only, so it is
  // a view control rather than something a shared link should carry.
  const [owners, setOwners] = useState<AdminHomeOwner[]>([])
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
  ]

  return (
    <AdminHomeSection
      title={t('adminHomeStateTitle')}
      description={t('adminHomeStateDescription')}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">{t('adminHomeNow')}</Badge>
          <OwnerFilter
            size="sm"
            className="w-44"
            value={owners}
            onChange={setOwners}
          />
        </div>
      }
      loading={loading}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-28 w-full"
    >
      <StatCard
        label={t('adminHomeTotalEquipment')}
        value={data?.total ?? 0}
        hint={t('adminHomeTotalEquipmentHint')}
        className="p-4"
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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
    </AdminHomeSection>
  )
}
