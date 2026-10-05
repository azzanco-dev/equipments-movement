import { useCallback, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { LogIn, LogOut } from 'lucide-react'
import { Button, PageHeader } from '@/components/ui'
import { AvailabilitySection } from '@/components/admin-home/AvailabilitySection'
import { EntriesFlowSection } from '@/components/admin-home/EntriesFlowSection'
import { FleetDonutSection } from '@/components/admin-home/FleetDonutSection'
import { FleetStateSection } from '@/components/admin-home/FleetStateSection'
import { ForemanActivitySection } from '@/components/admin-home/ForemanActivitySection'
import { WhatsAppStatusAlert } from '@/components/WhatsAppGatewayStatus'
import { useI18n } from '@/i18n/I18nContext'
import { useAuth } from '@/auth/AuthContext'
import { greetingName, greetingParts } from '@/lib/greetingName'
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
 * Order follows the owner's third review (2026-09-22), revised by the
 * approved design of 2026-09-30: the fleet's state right now across the full
 * width, with its mini tables under the cards (inside sites, in the workshop,
 * available, latest entries, latest added equipment — "متاحة" replaced the
 * standalone "معدات بلا حركة" section), then "التوفر حسب النوع", the two
 * donuts, the entries chart and the per-foreman activity cards.
 *
 * There is no page-level owner filter any more (owner review, same session):
 * the owner is a dimension each section answers for itself. The sections that
 * list equipment carry their own owner multi-select (the fleet section's one
 * filter reaches its cards and its mini tables together), and the donuts carry
 * none at all because owner is already one of the two slices they draw.
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
  const { profile } = useAuth()
  const name = greetingName(profile?.full_name)
  const parts = greetingParts(t('homeGreeting'), name !== '')
  const greeting = parts ? (
    <>
      {parts.before}
      <bdi>{name}</bdi>
      {parts.after}
    </>
  ) : null
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
    <>
      {/* wave 12: small screens only, admin only, and only when the WhatsApp
          gateway is known to be disconnected (the sidebar shows it on lg+).
          Outside the spaced column so a hidden alert leaves no gap. */}
      <WhatsAppStatusAlert className="mb-4" />
      <div className="space-y-4">
        <PageHeader
          title={greeting ?? t('adminHomeTitle')}
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
        <FleetStateSection onSelectEquipment={onSelectEquipment} />
        {/* Its former neighbour "معدات بلا حركة" is now the "متاحة" mini table
          under the state cards, so the availability table takes the full
          width. */}
        <AvailabilitySection />
        <FleetDonutSection />
        <EntriesFlowSection
          granularity={granularity}
          onGranularityChange={setGranularity}
          showExits={showExits}
          onShowExitsChange={setShowExits}
        />
        <ForemanActivitySection />
      </div>
    </>
  )
}
