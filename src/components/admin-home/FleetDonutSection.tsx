import { useCallback, useMemo, useState } from 'react'
import { X } from 'lucide-react'
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

/** Which chart the cross-filter is currently pinned to, if any. */
type Focus =
  | { kind: 'owner'; id: AdminHomeOwner }
  | { kind: 'state'; id: FleetStateId }
  | null

/**
 * No owner filter: the whole fleet, always. `ownerFilterArgument` turns an
 * empty selection into the NULL `p_owners` the database reads as "every
 * owner", and the constant lives at module scope so the loader's identity
 * never changes and the section cannot reload itself on every render.
 */
const EVERY_OWNER: AdminHomeOwner[] = []

/**
 * "اين الاسطول الان": two donuts side by side — the fleet by owner and the
 * fleet by state (owner request, 2026-09-22, replacing the single donut with
 * its drill-down).
 *
 * The two charts cross-filter each other: selecting an owner redraws the state
 * donut as that owner's states, selecting a state redraws the owner donut as
 * the owners inside that state, and "الغاء التصفية" resets both. Only one
 * focus exists at a time, so the pair always answers one question rather than
 * two half-applied filters.
 *
 * This section deliberately has no owner filter (owner review, 2026-09-22,
 * third pass): the owner is one of the two slices drawn here, so filtering by
 * owner would be filtering the answer out of the chart. Selecting an owner
 * slice is the filter.
 *
 * Both charts come from one snapshot (`get_admin_owner_state_matrix`), so a
 * cross-filter never costs a request and the halves can never be drawn from
 * two different moments.
 */
export function FleetDonutSection() {
  const { t, lang, dir } = useI18n()
  const ownerLabel = useOwnerLabel()
  const [focus, setFocus] = useState<Focus>(null)

  const load = useCallback(
    (signal: AbortSignal) => fetchOwnerStateMatrix(EVERY_OWNER, signal),
    [],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const count = useCallback(
    (ownerId: string, state: string) => data?.count(ownerId, state) ?? 0,
    [data],
  )

  // Every owner: the owner donut is the place the split is read, so it always
  // draws the full set of classifications.
  const visibleOwners = useMemo(() => [...ADMIN_HOME_OWNERS], [])

  // A focus on the other chart narrows this one; a focus on this chart only
  // highlights it, so clicking an owner never reduces the owner donut to that
  // single owner and hides the comparison the user is looking at.
  const stateScope: readonly FleetStateId[] = useMemo(
    () => (focus?.kind === 'state' ? [focus.id] : FLEET_STATES),
    [focus],
  )
  const ownerScope: readonly AdminHomeOwner[] = useMemo(
    () => (focus?.kind === 'owner' ? [focus.id] : visibleOwners),
    [focus, visibleOwners],
  )

  const ownerSlices: FleetDonutSlice[] = useMemo(
    () =>
      visibleOwners.map((ownerId) => {
        const index = ADMIN_HOME_OWNERS.indexOf(ownerId)
        return {
          id: ownerId,
          label: ownerLabel(ownerId),
          color: seriesColor(index),
          strokeColor: seriesStroke(index),
          value: stateScope.reduce(
            (sum, state) => sum + count(ownerId, state),
            0,
          ),
        }
      }),
    [count, ownerLabel, stateScope, visibleOwners],
  )

  const stateSlices: FleetDonutSlice[] = useMemo(
    () =>
      FLEET_STATES.map((state) => ({
        id: state,
        label: t(STATE_STYLE[state].label),
        color: STATE_STYLE[state].color,
        strokeColor: STATE_STYLE[state].stroke,
        value: ownerScope.reduce(
          (sum, ownerId) => sum + count(ownerId, state),
          0,
        ),
      })),
    [count, ownerScope, t],
  )

  const focusLabel =
    focus?.kind === 'owner'
      ? ownerLabel(focus.id)
      : focus?.kind === 'state'
        ? t(STATE_STYLE[focus.id].label)
        : null

  return (
    <AdminHomeSection
      title={t('adminHomeDonutTitle')}
      description={t('adminHomeDonutDescription')}
      action={<Badge tone="info">{t('adminHomeNow')}</Badge>}
      loading={loading}
      failed={failed}
      onRetry={retry}
      skeletonClassName="h-80 w-full"
    >
      {focusLabel && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>
            {t('adminHomeDonutFilteredBy')}{' '}
            <span className="font-medium text-fg">{focusLabel}</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setFocus(null)}
            icon={<X size={14} aria-hidden="true" />}
          >
            {t('adminHomeDonutClearFilter')}
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-medium text-fg">
            {t('adminHomeDonutOwnerTitle')}
          </h3>
          <FleetDonut
            ariaLabel={`${t('adminHomeDonutTitle')} — ${t(
              'adminHomeDonutOwnerTitle',
            )}`}
            dir={dir}
            lang={lang}
            slices={ownerSlices}
            centerLabel={t('adminHomeDonutTotal')}
            activeId={focus?.kind === 'owner' ? focus.id : null}
            hint={t('adminHomeDonutCrossHint')}
            onSliceSelect={(slice) =>
              setFocus((current) =>
                current?.kind === 'owner' && current.id === slice.id
                  ? null
                  : { kind: 'owner', id: slice.id as AdminHomeOwner },
              )
            }
          />
        </div>
        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-medium text-fg">
            {t('adminHomeDonutStateTitle')}
          </h3>
          <FleetDonut
            ariaLabel={`${t('adminHomeDonutTitle')} — ${t(
              'adminHomeDonutStateTitle',
            )}`}
            dir={dir}
            lang={lang}
            slices={stateSlices}
            centerLabel={t('adminHomeDonutTotal')}
            activeId={focus?.kind === 'state' ? focus.id : null}
            hint={t('adminHomeDonutCrossHint')}
            onSliceSelect={(slice) =>
              setFocus((current) =>
                current?.kind === 'state' && current.id === slice.id
                  ? null
                  : { kind: 'state', id: slice.id as FleetStateId },
              )
            }
          />
        </div>
      </div>
    </AdminHomeSection>
  )
}
