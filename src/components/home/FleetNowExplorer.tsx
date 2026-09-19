import { useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { cn } from '@/components/ui/cn'
import { seriesColor, seriesStroke } from '@/components/charts'
import type { ChartDirection } from '@/components/charts'
import { FleetDonut } from '@/components/charts/lazy'
import type { Language } from '@/i18n/translations'

/** One owner classification (Al-Azani, Takween, third party, ...). */
export interface FleetOwnerOption {
  id: string
  label: string
}

/**
 * One place a unit can be right now. The list is data, not code: adding a
 * future state such as "ورشة عامة" only means adding an entry here plus the
 * matching counts, with no change to this component.
 */
export interface FleetStateCategory {
  id: string
  label: string
  /** Pale tint token such as `var(--chart-1)`. */
  color: string
  /** Matching outline token such as `var(--chart-stroke-1)`. */
  strokeColor?: string
}

export interface FleetNowExplorerLabels {
  /** Segmented option covering every owner. */
  allOwners: string
  /** Accessible name for the owner segmented control. */
  ownerFilter: string
  /** Caption under the number in the middle, for example "معدة". */
  total: string
  /** Accessible name of the donut while it shows the states. */
  byState: string
  /** Accessible name of the donut while it shows one state by owner.
   *  Receives the state label. */
  byOwner: (stateLabel: string) => string
  /** One line telling the user the slices are clickable. */
  drillHint: string
  /** Label of the button that leaves the drill-down. */
  back: string
}

export interface FleetNowExplorerProps {
  owners: FleetOwnerOption[]
  states: FleetStateCategory[]
  /** Units of one owner in one state, right now. */
  count: (ownerId: string, stateId: string) => number
  labels: FleetNowExplorerLabels
  /**
   * Pending owner decision (2026-09-19). `true` (the default) makes the
   * drill-in always cover every owner, because "who owns the units in the
   * workshop" is the question that was asked. `false` keeps the owner filter
   * applied inside the drill, so a filtered donut drills into that owner only.
   */
  drillIgnoresOwnerFilter?: boolean
  /** Overrides the ambient direction, for side-by-side locale previews. */
  dir?: ChartDirection
  /** Overrides the ambient interface language for built-in chart labels. */
  lang?: Language
  loading?: boolean
  error?: ReactNode
  className?: string
}

const ALL_OWNERS = '__all__'

/**
 * The fleet donut, interactive in both directions.
 *
 * Sideways: the segmented control narrows the donut to one owner's units,
 * split across the states. Inwards: clicking a state flips the donut to that
 * state split by owner, with a breadcrumb back to the full view. The drill-in
 * always covers every owner, because "who owns the units in the workshop" is
 * the question the owner asked, so leaving the drill restores the filter that
 * was selected before.
 */
export function FleetNowExplorer({
  owners,
  states,
  count,
  labels,
  drillIgnoresOwnerFilter = true,
  dir,
  lang,
  loading = false,
  error,
  className,
}: FleetNowExplorerProps) {
  const [owner, setOwner] = useState<string>(ALL_OWNERS)
  const [drillStateId, setDrillStateId] = useState<string | null>(null)

  const drillState = useMemo(
    () => states.find((state) => state.id === drillStateId) ?? null,
    [drillStateId, states],
  )

  // Sideways view: the selected owner (or every owner) split across states.
  const stateSlices = useMemo(
    () =>
      states.map((state) => ({
        id: state.id,
        label: state.label,
        color: state.color,
        strokeColor: state.strokeColor,
        value:
          owner === ALL_OWNERS
            ? owners.reduce(
                (sum, option) => sum + count(option.id, state.id),
                0,
              )
            : count(owner, state.id),
      })),
    [count, owner, owners, states],
  )

  // Drilled-in view: one state split by owner. Whether the owner filter still
  // applies here is the pending decision above.
  const ownerSlices = useMemo(() => {
    if (!drillState) return []
    const visible =
      drillIgnoresOwnerFilter || owner === ALL_OWNERS
        ? owners
        : owners.filter((option) => option.id === owner)
    return visible.map((option) => {
      const index = owners.findIndex((entry) => entry.id === option.id)
      return {
        id: option.id,
        label: option.label,
        color: seriesColor(index),
        strokeColor: seriesStroke(index),
        value: count(option.id, drillState.id),
      }
    })
  }, [count, drillIgnoresOwnerFilter, drillState, owner, owners])

  const ownerLabel =
    owners.find((option) => option.id === owner)?.label ?? labels.allOwners

  return (
    <div className={cn('space-y-3', className)}>
      {drillState ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDrillStateId(null)}
            icon={
              <ChevronLeft
                size={14}
                aria-hidden="true"
                className="ltr:rotate-0 rtl:rotate-180"
              />
            }
          >
            {labels.back}
          </Button>
          <nav aria-label={labels.byState} className="min-w-0">
            <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <li>
                <button
                  type="button"
                  onClick={() => setDrillStateId(null)}
                  className="rounded hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {ownerLabel}
                </button>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="font-medium text-fg">
                {drillState.label}
              </li>
            </ol>
          </nav>
        </div>
      ) : (
        <Tabs value={owner} onValueChange={setOwner}>
          {/* Six options are wider than a 375 px screen. TabsList is already
              `max-w-full overflow-x-auto`, so the control scrolls on its own
              and the page never scrolls sideways. */}
          <TabsList variant="segmented" aria-label={labels.ownerFilter}>
            <TabsTrigger value={ALL_OWNERS}>{labels.allOwners}</TabsTrigger>
            {owners.map((option) => (
              <TabsTrigger key={option.id} value={option.id}>
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {drillState ? (
        <FleetDonut
          key="by-owner"
          ariaLabel={labels.byOwner(drillState.label)}
          dir={dir}
          lang={lang}
          loading={loading}
          error={error}
          slices={ownerSlices}
          centerLabel={labels.total}
        />
      ) : (
        <FleetDonut
          key="by-state"
          ariaLabel={labels.byState}
          dir={dir}
          lang={lang}
          loading={loading}
          error={error}
          slices={stateSlices}
          centerLabel={labels.total}
          hint={labels.drillHint}
          onSliceSelect={(slice) => setDrillStateId(slice.id)}
        />
      )}
    </div>
  )
}
