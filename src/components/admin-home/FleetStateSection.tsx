import { useCallback, useState, type ReactNode } from 'react'
import {
  CircleCheck,
  ClipboardList,
  MapPin,
  ParkingCircle,
  Truck,
  Warehouse,
  Wrench,
} from 'lucide-react'
import { Badge, StatCard, cn } from '@/components/ui'
import type { StatCardAccent } from '@/components/ui/StatCard'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { fetchFleetState } from '@/lib/adminHomeData'
import {
  DEFAULT_HOME_OWNERS,
  type AdminHomeOwner,
  type FleetDrillState,
  type FleetState,
} from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { HomeOwnerFilter } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

interface FleetCard {
  id: FleetDrillState
  label: TranslationKey
  value: (data: FleetState) => number
  accent: StatCardAccent
  icon: ReactNode
  hint?: TranslationKey
  /** Classes for the card's grid cell (a lone third card spans the row on a
   *  phone instead of leaving a hole). */
  cellClassName?: string
}

const ICON_SIZE = 20

/**
 * The seven cards, in drawing order. Accents are tokens only: green for
 * inside sites (the ENTRY colour), blue for the workshop, neutral for what is
 * free, amber for maintenance (as on the workshop home), and two light chart
 * hues for standby and unclassified, which carry no status meaning of their
 * own. The total is monochrome, like every primary element.
 */
const TOTAL_CARD: FleetCard = {
  id: 'total',
  label: 'adminHomeTotalEquipment',
  hint: 'adminHomeTotalEquipmentHint',
  value: (data) => data.total,
  accent: 'primary',
  icon: <Truck size={ICON_SIZE} />,
}

const STATE_CARDS: FleetCard[] = [
  {
    id: 'inside_site',
    label: 'adminHomeInsideSites',
    value: (data) => data.insideSites,
    accent: 'success',
    icon: <MapPin size={ICON_SIZE} />,
  },
  {
    id: 'workshop',
    label: 'adminHomeInWorkshop',
    value: (data) => data.inWorkshop,
    accent: 'info',
    icon: <Warehouse size={ICON_SIZE} />,
  },
  {
    id: 'available',
    label: 'adminHomeAvailable',
    value: (data) => data.available,
    accent: 'neutral',
    icon: <CircleCheck size={ICON_SIZE} />,
    cellClassName: 'col-span-2 lg:col-span-1',
  },
]

const WORKSHOP_CARDS: FleetCard[] = [
  {
    id: 'workshop_maintenance',
    label: 'adminHomeMaintenance',
    value: (data) => data.workshopMaintenance,
    accent: 'warning',
    icon: <Wrench size={ICON_SIZE} />,
  },
  {
    id: 'workshop_parking',
    label: 'adminHomeParking',
    value: (data) => data.workshopParking,
    accent: 'chart-6',
    icon: <ParkingCircle size={ICON_SIZE} />,
  },
  {
    id: 'workshop_unclassified',
    label: 'adminHomeUnclassified',
    value: (data) => data.workshopUnclassified,
    accent: 'chart-5',
    icon: <ClipboardList size={ICON_SIZE} />,
    cellClassName: 'col-span-2 lg:col-span-1',
  },
]

export interface FleetStateSectionProps {
  /**
   * Called with the card's state when a card is clicked. Until the drill-down
   * panel exists (owner request 2026-09-30, design only), the screen does not
   * pass it, and the cards stay plain, non-interactive cards: a card that looks
   * clickable must never do nothing.
   */
  onSelectState?: (state: FleetDrillState) => void
}

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
 * Owner review (2026-09-30): the cards take the accented look (tinted icon,
 * start border, bold number), and the workshop split that was a hint line
 * under "in the workshop" is a second row of three cards of its own.
 *
 * Nothing here is period-scoped, so the section carries the "now" chip and the
 * chart's granularity switch deliberately does not reach it.
 */
export function FleetStateSection({ onSelectState }: FleetStateSectionProps) {
  const { t } = useI18n()
  // Plain component state, not the URL: it scopes this section only, so it is
  // a view control rather than something a shared link should carry.
  const [owners, setOwners] = useState<AdminHomeOwner[]>(DEFAULT_HOME_OWNERS)
  const load = useCallback(
    (signal: AbortSignal) => fetchFleetState(owners, signal),
    [owners],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const renderCard = (card: FleetCard, className?: string) => (
    <StatCard
      key={card.id}
      label={t(card.label)}
      value={data ? card.value(data) : 0}
      hint={card.hint ? t(card.hint) : undefined}
      accent={card.accent}
      icon={card.icon}
      onClick={onSelectState ? () => onSelectState(card.id) : undefined}
      className={className}
    />
  )

  return (
    <AdminHomeSection
      title={t('adminHomeStateTitle')}
      description={t('adminHomeStateDescription')}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">{t('adminHomeNow')}</Badge>
          <HomeOwnerFilter
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
      skeletonClassName="h-72 w-full"
    >
      {renderCard(TOTAL_CARD, 'p-4')}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {STATE_CARDS.map((card) =>
          renderCard(card, cn('p-4', card.cellClassName)),
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted">
          {t('adminHomeWorkshopBreakdown')}
        </h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {WORKSHOP_CARDS.map((card) =>
            renderCard(card, cn('p-4', card.cellClassName)),
          )}
        </div>
      </div>
    </AdminHomeSection>
  )
}
