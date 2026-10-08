'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/components/ui/cn'
import type { LeafletLocationMapProps } from './LeafletProjectsMap'

/*
 * wave 17: one position on a small map (the «الموقع الحالي» card). Leaflet is
 * loaded exactly like `ProjectsMap` does it: a dynamic import of
 * ./LeafletProjectsMap (still the only file that imports Leaflet) started in
 * an effect and cached at module level, so nothing of Leaflet reaches the
 * server or a page that shows no map. A failed download is shown in place
 * with a retry, never as a blank box.
 */
let LoadedMap: ComponentType<LeafletLocationMapProps> | null = null
let pending: Promise<ComponentType<LeafletLocationMapProps>> | null = null

function loadMap() {
  pending ??= import('./LeafletProjectsMap').then(
    (module) => {
      LoadedMap = module.LeafletLocationMap
      return module.LeafletLocationMap
    },
    (error: unknown) => {
      pending = null
      throw error
    },
  )
  return pending
}

type LoadState = 'loading' | 'ready' | 'error'

export interface LocationMapProps {
  lat: number
  lng: number
  /** Accessible name of the marker, e.g. the equipment code. */
  markerLabel: string
  className?: string
}

export function LocationMap({
  lat,
  lng,
  markerLabel,
  className,
}: LocationMapProps) {
  const { t, lang } = useI18n()
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

  return (
    // Fixed height so the card never jumps while the map loads.
    <div
      className={cn(
        'relative h-56 overflow-hidden rounded-lg border bg-surface md:h-64',
        className,
      )}
    >
      {state === 'error' ? (
        <ErrorState
          title={t('projectsMapLoadError')}
          onRetry={() => setAttempt((value) => value + 1)}
          className="h-full justify-center rounded-none border-0 p-4"
        />
      ) : state === 'ready' && LoadedMap ? (
        <LoadedMap
          key={lang}
          lat={lat}
          lng={lng}
          label={t('afaqyLocationMapLabel')}
          markerLabel={markerLabel}
        />
      ) : (
        <div role="status" className="h-full w-full">
          <Skeleton className="h-full w-full rounded-none" />
          <span className="sr-only">{t('projectsMapLoading')}</span>
        </div>
      )}
    </div>
  )
}
