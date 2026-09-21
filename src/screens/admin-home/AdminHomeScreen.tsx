import { useCallback, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { LogIn, LogOut } from 'lucide-react'
import { Button, PageHeader } from '@/components/ui'
import { AvailabilitySection } from '@/components/admin-home/AvailabilitySection'
import { EntriesFlowSection } from '@/components/admin-home/EntriesFlowSection'
import { FleetDonutSection } from '@/components/admin-home/FleetDonutSection'
import { FleetStateSection } from '@/components/admin-home/FleetStateSection'
import { ForemanActivitySection } from '@/components/admin-home/ForemanActivitySection'
import { NoMovementSection } from '@/components/admin-home/NoMovementSection'
import { OwnerFilter } from '@/components/admin-home/OwnerFilter'
import { useI18n } from '@/i18n/I18nContext'
import {
  isAdminHomePeriod,
  normalizeOwnerFilter,
  type AdminHomeOwner,
  type AdminHomePeriod,
} from '@/lib/adminHomeStats'

export interface AdminHomeScreenProps {
  onSelectEquipment?: (id: string) => void
  /** Admin only: the legacy dashboard's register entry/exit shortcuts. */
  onCreateMovement?: (type: 'entry' | 'exit') => void
}

/**
 * The admin and monitor home page.
 *
 * Structure follows the approved mockup: the fleet's state right now, then the
 * equipment that has stopped moving (the section that asks for a decision),
 * then availability by type, the entries chart, the interactive donut and a
 * small foreman activity list.
 *
 * Every section owns its request and its own loading / failure state, so one
 * slow or broken section never blanks the page, and the owner filter and the
 * period are the only shared state. Both live in the URL (`?owner=` and
 * `?period=`), so Back restores the view the user was looking at and a link to
 * a filtered home page works.
 */
export function AdminHomeScreen({
  onSelectEquipment,
  onCreateMovement,
}: AdminHomeScreenProps) {
  const { t } = useI18n()
  const pathname = usePathname()
  const params = useSearchParams()
  const owner = normalizeOwnerFilter(params.get('owner'))
  const requestedPeriod = params.get('period')
  const period: AdminHomePeriod = isAdminHomePeriod(requestedPeriod)
    ? requestedPeriod
    : 'year'
  // Not worth a URL entry: it is a view toggle on one chart, not a filter that
  // changes which data was requested.
  const [showExits, setShowExits] = useState(false)

  const update = useCallback(
    (values: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      Object.entries(values).forEach(([key, value]) =>
        value === null ? next.delete(key) : next.set(key, value),
      )
      const query = next.toString()
      if (query === params.toString()) return
      window.history.replaceState(
        null,
        '',
        query ? `${pathname}?${query}` : pathname,
      )
    },
    [params, pathname],
  )

  const setOwner = useCallback(
    (value: AdminHomeOwner | null) => update({ owner: value }),
    [update],
  )
  const setPeriod = useCallback(
    (value: AdminHomePeriod) => update({ period: value }),
    [update],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('adminHomeTitle')}
        description={t('adminHomeDescription')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {onCreateMovement && (
              <>
                <Button
                  variant="primary"
                  onClick={() => onCreateMovement('entry')}
                  icon={<LogIn size={16} aria-hidden="true" />}
                >
                  {t('registerEntry')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onCreateMovement('exit')}
                  icon={<LogOut size={16} aria-hidden="true" />}
                >
                  {t('registerExit')}
                </Button>
              </>
            )}
            <OwnerFilter
              value={owner}
              onChange={setOwner}
              className="min-w-44"
            />
          </div>
        }
      />
      <FleetStateSection owner={owner} />
      <NoMovementSection owner={owner} onSelectEquipment={onSelectEquipment} />
      <AvailabilitySection owner={owner} />
      <EntriesFlowSection
        owner={owner}
        period={period}
        onPeriodChange={setPeriod}
        showExits={showExits}
        onShowExitsChange={setShowExits}
      />
      <FleetDonutSection owner={owner} />
      <ForemanActivitySection period={period} />
    </div>
  )
}
