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
  DEFAULT_HOME_OWNERS,
  FLEET_STATES,
  type AdminHomeOwner,
  type FleetStateId,
} from '@/lib/adminHomeStats'
import { AdminHomeSection } from './AdminHomeSection'
import { OwnerFilter, useOwnerLabel } from './OwnerFilter'
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
 * The section starts on the three in-house owners (owner decision,
 * 2026-09-29) and carries a small owner filter in its header so the user can
 * widen it. The filter scopes the whole snapshot, so both donuts always cover
 * the same set of owners; an empty selection means every owner. Selecting an
 * owner slice is still the cross-filter between the two charts.
 *
 * Both charts come from one snapshot (`get_admin_owner_state_matrix`), so a
 * cross-filter never costs a request and the halves can never be drawn from
 * two different moments.
 */
export function FleetDonutSection() {
  const { t, lang, dir } = useI18n()
  const ownerLabel = useOwnerLabel()
  const [focus, setFocus] = useState<Focus>(null)
  const [owners, setOwners] = useState<AdminHomeOwner[]>(DEFAULT_HOME_OWNERS)

  const load = useCallback(
    (signal: AbortSignal) => fetchOwnerStateMatrix(owners, signal),
    [owners],
  )
  const { data, loading, failed, retry } = useAdminHomeSection(load)

  const count = useCallback(
    (ownerId: string, state: string) => data?.count(ownerId, state) ?? 0,
    [data],
  )

  // The owner donut draws exactly the owners the section is filtered to (every
  // classification when the filter is cleared), so it matches the state donut.
  const visibleOwners = useMemo(
    () => (owners.length ? owners : [...ADMIN_HOME_OWNERS]),
    [owners],
  )

  const changeOwners = (next: AdminHomeOwner[]) => {
    setOwners(next)
    // A focused owner may have just left the set; drop the cross-filter so the
    // charts never describe an owner that is no longer drawn.
    setFocus(null)
  }

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
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">{t('adminHomeNow')}</Badge>
          <OwnerFilter
            size="sm"
            className="w-44"
            value={owners}
            onChange={changeOwners}
          />
        </div>
      }
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
