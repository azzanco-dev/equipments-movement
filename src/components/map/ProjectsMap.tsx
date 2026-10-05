'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { MapPinOff } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/components/ui/cn'
import {
  formatBubbleLabel,
  placeablePoints,
  totalsByKind,
  type ProjectsMapPoint,
  type ProjectsMapUnplaced,
} from '@/lib/projectsMap'
import type { LeafletProjectsMapProps } from './LeafletProjectsMap'

export type {
  ProjectsMapKind,
  ProjectsMapPoint,
  ProjectsMapUnplaced,
} from '@/lib/projectsMap'

export interface ProjectsMapProps {
  /** Places with a location: one bubble each, sized by `count`. */
  points: ProjectsMapPoint[]
  /** Projects with units inside but no saved location, listed under the map
   * so their units are not lost. */
  unplaced?: ProjectsMapUnplaced[]
  onSelect?: (id: string) => void
  selectedId?: string | null
  className?: string
}

/*
 * Leaflet is loaded the way the admin-home charts load Recharts
 * (src/components/charts/lazy.tsx): a hand-rolled dynamic import started in an
 * effect, cached at module level once it arrives. Nothing imports `leaflet`
 * outside ./LeafletProjectsMap, so the library and its stylesheet are a
 * separate chunk fetched only when a map mounts, and never run on the server.
 * Unlike the charts, a failed download is shown in place (with a retry)
 * instead of being thrown to an error boundary: the map is one section of a
 * page and must never leave a blank box.
 */
let LoadedMap: ComponentType<LeafletProjectsMapProps> | null = null
let pending: Promise<ComponentType<LeafletProjectsMapProps>> | null = null

function loadMap() {
  pending ??= import('./LeafletProjectsMap').then(
    (module) => {
      LoadedMap = module.LeafletProjectsMap
      return module.LeafletProjectsMap
    },
    (error: unknown) => {
      // Let a retry (or a later mount) try again.
      pending = null
      throw error
    },
  )
  return pending
}

type LoadState = 'loading' | 'ready' | 'error'

function useLeafletMap() {
  const [state, setState] = useState<LoadState>(LoadedMap ? 'ready' : 'loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (LoadedMap) {
      setState('ready')
      return
    }
    let active = true
    setState('loading')
    loadMap().then(
      () => {
        if (active) setState('ready')
      },
      () => {
        if (active) setState('error')
      },
    )
    return () => {
      active = false
    }
  }, [attempt])
  return { state, retry: () => setAttempt((value) => value + 1) }
}

/**
 * Interactive map of Riyadh with one count bubble per project (and the
 * workshop): how many units are inside each place right now. Presentational
 * only: the caller supplies the points and owns the selection.
 */
export function ProjectsMap({
  points,
  unplaced = [],
  onSelect,
  selectedId = null,
  className,
}: ProjectsMapProps) {
  const { t, lang } = useI18n()
  const { state, retry } = useLeafletMap()
  const hasPlaced = placeablePoints(points).length > 0
  const totals = totalsByKind(points, unplaced)
  const unitsLabel = (count: number) =>
    t('projectsMapUnitsCount').replace('{count}', String(count))

  return (
    <div className={cn('min-w-0 space-y-3', className)}>
      {/* Fixed responsive height so nothing below jumps while the map loads. */}
      <div className="relative h-80 overflow-hidden rounded-xl border bg-surface md:h-[440px]">
        {state === 'error' ? (
          <ErrorState
            title={t('projectsMapLoadError')}
            onRetry={retry}
            className="h-full justify-center rounded-none border-0"
          />
        ) : state === 'ready' && LoadedMap ? (
          // `key` re-creates the map (and its control titles) when the
          // interface language changes.
          <LoadedMap
            key={lang}
            points={points}
            selectedId={selectedId}
            onSelect={onSelect}
            label={t('projectsMapRegionLabel')}
          />
        ) : (
          <div role="status" className="h-full w-full">
            <Skeleton className="h-full w-full rounded-none" />
            <span className="sr-only">{t('projectsMapLoading')}</span>
          </div>
        )}
        {state === 'ready' && !hasPlaced && (
          <div className="pointer-events-none absolute inset-x-0 bottom-8 z-[1000] flex justify-center px-4">
            <p className="rounded-lg border bg-bg px-3 py-1.5 text-center text-sm text-fg">
              {unplaced.length > 0
                ? t('projectsMapNoLocations')
                : t('projectsMapEmpty')}
            </p>
          </div>
        )}
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <li className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="pm-swatch pm-swatch--project h-3 w-3 shrink-0"
          />
          <span className="text-fg">{t('projectsMapLegendProject')}</span>
          <span>{unitsLabel(totals.project)}</span>
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="pm-swatch pm-swatch--workshop h-3 w-3 shrink-0"
          />
          <span className="text-fg">{t('projectsMapLegendWorkshop')}</span>
          <span>{unitsLabel(totals.workshop)}</span>
        </li>
        <li className="text-muted">{t('projectsMapLegendSize')}</li>
      </ul>

      {unplaced.length > 0 && (
        <div className="space-y-1.5">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
            <MapPinOff size={14} aria-hidden="true" />
            {t('projectsMapUnplaced')}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {unplaced.map((row) => {
              const content = (
                <>
                  <span className="truncate-safe max-w-[16rem]">
                    {row.name}
                  </span>
                  <span className="font-semibold">{row.count}</span>
                </>
              )
              const chip =
                'inline-flex items-center gap-1.5 rounded-lg border bg-bg px-2.5 py-1 text-xs text-fg'
              return (
                <li key={row.id}>
                  {onSelect ? (
                    <button
                      type="button"
                      aria-pressed={row.id === selectedId}
                      aria-label={formatBubbleLabel(
                        t('projectsMapBubbleLabel'),
                        row.name,
                        row.count,
                      )}
                      onClick={() => onSelect(row.id)}
                      className={cn(
                        chip,
                        'hover:bg-surface-hover',
                        row.id === selectedId && 'border-fg',
                      )}
                    >
                      {content}
                    </button>
                  ) : (
                    <span className={chip}>{content}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
