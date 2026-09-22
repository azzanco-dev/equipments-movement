import { useCallback, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { LogIn, LogOut } from 'lucide-react'
import { Button, PageHeader } from '@/components/ui'
import { AvailabilitySection } from '@/components/admin-home/AvailabilitySection'
import { EntriesFlowSection } from '@/components/admin-home/EntriesFlowSection'
import { FleetDonutSection } from '@/components/admin-home/FleetDonutSection'
import { FleetStateSection } from '@/components/admin-home/FleetStateSection'
import { ForemanActivitySection } from '@/components/admin-home/ForemanActivitySection'
import { NoMovementSection } from '@/components/admin-home/NoMovementSection'
import { OwnerFilterBar } from '@/components/admin-home/OwnerFilter'
import { useI18n } from '@/i18n/I18nContext'
import {
  normalizeGranularity,
  normalizeOwnerFilters,
  serializeOwnerFilters,
  type AdminHomeGranularity,
  type AdminHomeOwner,
} from '@/lib/adminHomeStats'

export interface AdminHomeScreenProps {
  onSelectEquipment?: (id: string) => void
  /** Admin only: the legacy dashboard's register entry/exit shortcuts. */
  onCreateMovement?: (type: 'entry' | 'exit') => void
}

/**
 * The admin and monitor home page.
 *
 * Order follows the owner's review (2026-09-22): the owner filter is the first
 * thing on the page, because it scopes everything under it, then the fleet's
 * state right now, the equipment that has stopped moving (the section that
 * asks for a decision), availability by type, the entries chart, the two
 * donuts and the per-foreman activity cards.
 *
 * Every section owns its request and its own loading / failure state, so one
 * slow or broken section never blanks the page, and the owner filter and the
 * chart granularity are the only shared state. Both live in the URL
 * (`?owners=a,b` and `?flow=`), so Back restores the view the user was looking
 * at and a link to a filtered home page works.
 */
export function AdminHomeScreen({
  onSelectEquipment,
  onCreateMovement,
}: AdminHomeScreenProps) {
  const { t } = useI18n()
  const pathname = usePathname()
  const params = useSearchParams()
  // An empty selection is "every owner", so an unknown or hand-edited value
  // degrades to the unfiltered page instead of an error. Memoized on the raw
  // parameter: every section's loader depends on this array by identity, so a
  // fresh array per render would reload the whole page on every render.
  const ownersParam = params.get('owners') ?? ''
  const owners = useMemo(
    () => normalizeOwnerFilters(ownersParam),
    [ownersParam],
  )
  const granularity = normalizeGranularity(params.get('flow'))
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

  const setOwners = useCallback(
    (value: AdminHomeOwner[]) =>
      update({ owners: serializeOwnerFilters(value) }),
    [update],
  )
  const setGranularity = useCallback(
    (value: AdminHomeGranularity) => update({ flow: value }),
    [update],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('adminHomeTitle')}
        description={t('adminHomeDescription')}
        actions={
          onCreateMovement ? (
            <div className="flex flex-wrap items-center gap-2">
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
            </div>
          ) : undefined
        }
      />
      <OwnerFilterBar value={owners} onChange={setOwners} />
      <FleetStateSection owners={owners} />
      <NoMovementSection
        owners={owners}
        onSelectEquipment={onSelectEquipment}
      />
      <AvailabilitySection owners={owners} />
      <EntriesFlowSection
        owners={owners}
        granularity={granularity}
        onGranularityChange={setGranularity}
        showExits={showExits}
        onShowExitsChange={setShowExits}
      />
      <FleetDonutSection owners={owners} />
      <ForemanActivitySection />
    </div>
  )
}
