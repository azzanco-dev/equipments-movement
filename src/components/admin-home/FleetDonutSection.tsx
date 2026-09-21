import { useCallback, useMemo, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { seriesColor, seriesStroke } from '@/components/charts'
import { FleetDonut } from '@/components/charts/lazy'
import type { FleetDonutSlice } from '@/components/charts/lazy'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { fetchOwnerStateMatrix } from '@/lib/adminHomeData'
import {
  ADMIN_HOME_OWNERS,
  FLEET_STATES,
  type AdminHomeOwner,
  type FleetStateId,
} from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { useOwnerLabel } from './OwnerFilter'
import { useAdminHomeSection } from './useAdminHomeSection'

/**
 * The states are data, not code: a future state only needs a new entry here
 * plus the matching classification in migration 0094. The pale tint and its
 * matching outline come from the `--chart-*` tokens, never from a palette
 * class.
 */
const STATE_STYLE: Record<
  FleetStateId,
  { label: TranslationKey; color: string; stroke: string }
> = {
  inside_site: {
    label: 'adminHomeStateInsideSite',
    color: 'var(--chart-1)',
    stroke: 'var(--chart-stroke-1)',
  },
  workshop_maintenance: {
    label: 'adminHomeStateMaintenance',
    color: 'var(--chart-2)',
    stroke: 'var(--chart-stroke-2)',
  },
  workshop_parking: {
    label: 'adminHomeStateParking',
    color: 'var(--chart-3)',
    stroke: 'var(--chart-stroke-3)',
  },
  workshop_unclassified: {
    label: 'adminHomeStateUnclassified',
    color: 'var(--chart-5)',
    stroke: 'var(--chart-stroke-5)',
  },
  available: {
    label: 'adminHomeStateAvailable',
    color: 'var(--chart-4)',
    stroke: 'var(--chart-stroke-4)',
  },
}

export interface FleetDonutSectionProps {
  owner: AdminHomeOwner | null
}

/**
 * "اين الاسطول الان": the interactive donut, in both directions.
 *
 * Sideways, the page's owner filter narrows the donut to one owner's units
 * split across the states. Inwards, clicking a state flips the donut to that
 * state split by owner, with a breadcrumb back.
 *
 * Owner decision applied here: the drill-down RESPECTS the owner filter. With
 * "العزاني" selected, drilling into "في الورشة" answers "how many Al-Azani
 * units are in the workshop", never "who owns everything in the workshop" —
 * the filter the user set is never silently dropped.
 *
 * Both directions come from one snapshot (`get_admin_owner_state_matrix`), so
 * a drill never costs a request and the two views can never be computed from
 * two different moments.
 */
export function FleetDonutSection({ owner }: FleetDonutSectionProps) {
  const { t, lang, dir } = useI18n()
  const ownerLabel = useOwnerLabel()
  const [drillState, setDrillState] = useState<FleetStateId | null>(null)

  const load = useCallback(
    (signal: AbortSignal) => fetchOwnerStateMatrix(signal),
    [],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const count = useCallback(
    (ownerId: string, state: string) => data?.count(ownerId, state) ?? 0,
    [data],
  )

  // The owners in view: the whole list, or just the selected one.
  const visibleOwners = useMemo(
    () => (owner ? [owner] : [...ADMIN_HOME_OWNERS]),
    [owner],
  )

  const stateSlices: FleetDonutSlice[] = useMemo(
    () =>
      FLEET_STATES.map((state) => ({
        id: state,
        label: t(STATE_STYLE[state].label),
        color: STATE_STYLE[state].color,
        strokeColor: STATE_STYLE[state].stroke,
        value: visibleOwners.reduce(
          (sum, ownerId) => sum + count(ownerId, state),
          0,
        ),
      })),
    [count, t, visibleOwners],
  )

  const ownerSlices: FleetDonutSlice[] = useMemo(() => {
    if (!drillState) return []
    return visibleOwners.map((ownerId) => {
      const index = ADMIN_HOME_OWNERS.indexOf(ownerId)
      return {
        id: ownerId,
        label: ownerLabel(ownerId),
        color: seriesColor(index),
        strokeColor: seriesStroke(index),
        value: count(ownerId, drillState),
      }
    })
  }, [count, drillState, ownerLabel, visibleOwners])

  const scopeLabel = owner ? ownerLabel(owner) : t('allOwners')

  return (
    <AdminHomeSection
      title={t('adminHomeDonutTitle')}
      description={t('adminHomeDonutDescription')}
      action={<Badge tone="info">{t('adminHomeNow')}</Badge>}
      loading={loading}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-64 w-full"
    >
      {drillState ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDrillState(null)}
            icon={
              <ChevronLeft
                size={14}
                aria-hidden="true"
                className="ltr:rotate-0 rtl:rotate-180"
              />
            }
          >
            {t('adminHomeBack')}
          </Button>
          <nav aria-label={t('adminHomeDonutStateAria')} className="min-w-0">
            <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <li>
                <button
                  type="button"
                  onClick={() => setDrillState(null)}
                  className="rounded hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {scopeLabel}
                </button>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="font-medium text-fg">
                {t(STATE_STYLE[drillState].label)}
              </li>
            </ol>
          </nav>
        </div>
      ) : null}

      {drillState ? (
        <FleetDonut
          key="by-owner"
          ariaLabel={`${t(STATE_STYLE[drillState].label)} — ${t(
            'adminHomeDonutOwnerAria',
          )}`}
          dir={dir}
          lang={lang}
          slices={ownerSlices}
          centerLabel={t('adminHomeDonutTotal')}
        />
      ) : (
        <FleetDonut
          key="by-state"
          ariaLabel={t('adminHomeDonutStateAria')}
          dir={dir}
          lang={lang}
          slices={stateSlices}
          centerLabel={t('adminHomeDonutTotal')}
          hint={t('adminHomeDonutHint')}
          onSliceSelect={(slice) => setDrillState(slice.id as FleetStateId)}
        />
      )}
    </AdminHomeSection>
  )
}
