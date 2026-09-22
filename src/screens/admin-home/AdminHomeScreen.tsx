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
import { useI18n } from '@/i18n/I18nContext'
import {
  normalizeGranularity,
  type AdminHomeGranularity,
} from '@/lib/adminHomeStats'

export interface AdminHomeScreenProps {
  onSelectEquipment?: (id: string) => void
  /** Admin only: the legacy dashboard's register entry/exit shortcuts. */
  onCreateMovement?: (type: 'entry' | 'exit') => void
}

/**
 * The admin and monitor home page.
 *
 * Order follows the owner's third review (2026-09-22): the fleet's state right
 * now across the full width, then the two tables that answer a question about
 * specific equipment side by side — "معدات بلا حركة" first, because it asks for
 * a decision, and "التوفر حسب النوع" next to it instead of underneath it — then
 * the two donuts, the entries chart and the per-foreman activity cards.
 *
 * There is no page-level owner filter any more (owner review, same session):
 * the owner is a dimension each section answers for itself. The sections that
 * list equipment carry their own owner multi-select, and the donuts carry none
 * at all because owner is already one of the two slices they draw.
 *
 * Every section owns its request and its own loading / failure state, so one
 * slow or broken section never blanks the page. The chart granularity is the
 * only state the screen still holds, and it lives in the URL (`?flow=`), so
 * Back restores the view the user was looking at.
 */
export function AdminHomeScreen({
  onSelectEquipment,
  onCreateMovement,
}: AdminHomeScreenProps) {
  const { t } = useI18n()
  const pathname = usePathname()
  const params = useSearchParams()
  const granularity = normalizeGranularity(params.get('flow'))
  // Not worth a URL entry: it is a view toggle on one chart, not a filter that
  // changes which data was requested.
  const [showExits, setShowExits] = useState(false)

  const setGranularity = useCallback(
    (value: AdminHomeGranularity) => {
      const next = new URLSearchParams(params.toString())
      next.set('flow', value)
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
      <FleetStateSection />
      {/* The owner asked why these two were stacked: they are two halves of the
          same question (which units are idle, and which types are free), so
          they sit side by side from lg up and stack on a phone. Each column is
          `min-w-0`, without which a grid column keeps its content's intrinsic
          width and the wide tables push the whole page sideways instead of
          scrolling inside their own card. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <NoMovementSection onSelectEquipment={onSelectEquipment} />
        </div>
        <div className="min-w-0">
          <AvailabilitySection />
        </div>
      </div>
      <FleetDonutSection />
      <EntriesFlowSection
        granularity={granularity}
        onGranularityChange={setGranularity}
        showExits={showExits}
        onShowExitsChange={setShowExits}
      />
      <ForemanActivitySection />
    </div>
  )
}
