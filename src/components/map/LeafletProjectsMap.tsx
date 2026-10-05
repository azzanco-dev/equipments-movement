'use client'

import { useEffect, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useI18n } from '@/i18n/I18nContext'
import { useTheme } from '@/theme/ThemeContext'
import {
  FIT_MAX_ZOOM,
  PROJECTS_MAP_TILES,
  bubbleDiameter,
  bubbleHtml,
  formatBubbleLabel,
  initialView,
  maxPointCount,
  placeablePoints,
  stackingOffset,
  viewKey,
  visibleLabelIds,
  type LabelCandidate,
  type ProjectsMapPoint,
} from '@/lib/projectsMap'

/**
 * The Leaflet half of `ProjectsMap`. Only `./ProjectsMap` imports this file,
 * and only through a dynamic import started in an effect, so Leaflet (and its
 * stylesheet) is downloaded when a map is actually on screen and is never
 * evaluated on the server (Leaflet reads `window` when it loads).
 */
export interface LeafletProjectsMapProps {
  points: ProjectsMapPoint[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  /** Accessible name of the map region. */
  label: string
}

/** Edge room when framing: bubbles are up to 64 px and names sit below. */
const FIT_PADDING_TOP_LEFT: L.PointTuple = [48, 48]
const FIT_PADDING_BOTTOM_RIGHT: L.PointTuple = [48, 64]
/** Gap between a bubble and its name label, matching `.pm-label`. */
const LABEL_GAP = 4
const HINT_MS = 1800

// lucide "scan" (frame corners): reads as "fit everything in view".
const RESET_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>'

type Hint = 'wheel' | 'touch' | null

function applyView(map: L.Map, points: readonly ProjectsMapPoint[]) {
  const view = initialView(points)
  if (view.kind === 'center') map.setView(view.center, view.zoom)
  else
    map.fitBounds(view.bounds, {
      paddingTopLeft: FIT_PADDING_TOP_LEFT,
      paddingBottomRight: FIT_PADDING_BOTTOM_RIGHT,
      maxZoom: FIT_MAX_ZOOM,
    })
}

export function LeafletProjectsMap({
  points,
  selectedId = null,
  onSelect,
  label,
}: LeafletProjectsMapProps) {
  const { t } = useI18n()
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const markersRef = useRef(new Map<string, L.Marker>())
  const pointsRef = useRef(points)
  const selectedRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)
  const [hint, setHint] = useState<Hint>(null)
  const [tilesFailed, setTilesFailed] = useState(false)

  pointsRef.current = points
  selectedRef.current = selectedId
  onSelectRef.current = onSelect

  // Strings the Leaflet controls read once, at creation.
  const zoomInTitle = t('projectsMapZoomIn')
  const zoomOutTitle = t('projectsMapZoomOut')
  const resetTitle = t('projectsMapResetView')

  // Create the map once per mount. React 18 StrictMode mounts twice in
  // development; `map.remove()` in the cleanup clears Leaflet's id from the
  // container, so the second mount starts from a clean element.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // The page is RTL, but Leaflet lays out panes and controls by left/top;
    // the container itself is `dir="ltr"`, and controls go to the page's
    // start side (the zoom) and end side (the attribution) here instead.
    const pageDir =
      getComputedStyle(container.parentElement ?? container).direction === 'rtl'
        ? 'rtl'
        : 'ltr'
    const coarse =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches

    const map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      // Wheel zoom only once the map has focus, so scrolling the page past
      // the map never zooms it by accident.
      scrollWheelZoom: false,
      // On touch screens one finger keeps scrolling the page; two fingers
      // pan and pinch the map (TouchZoom follows the pinch centre).
      dragging: !coarse,
      touchZoom: true,
      minZoom: 5,
      maxZoom: 18,
      zoomSnap: 1,
    })
    mapRef.current = map

    const startCorner = pageDir === 'rtl' ? 'topright' : 'topleft'
    L.control
      .zoom({ position: startCorner, zoomInTitle, zoomOutTitle })
      .addTo(map)

    const ResetControl = L.Control.extend({
      onAdd() {
        const bar = L.DomUtil.create('div', 'leaflet-bar pm-reset')
        const button = L.DomUtil.create('button', 'pm-reset-button', bar)
        button.type = 'button'
        button.title = resetTitle
        button.setAttribute('aria-label', resetTitle)
        button.innerHTML = RESET_ICON
        L.DomEvent.disableClickPropagation(bar)
        L.DomEvent.on(button, 'click', () => applyView(map, pointsRef.current))
        return bar
      },
    })
    new ResetControl({ position: startCorner }).addTo(map)

    L.control
      .attribution({
        position: pageDir === 'rtl' ? 'bottomleft' : 'bottomright',
        prefix: false,
      })
      .addTo(map)

    layerRef.current = L.layerGroup().addTo(map)
    applyView(map, pointsRef.current)

    // --- focus-gated wheel zoom and the gesture hints -------------------
    let hintTimer: ReturnType<typeof setTimeout> | undefined
    const showHint = (next: Exclude<Hint, null>) => {
      setHint(next)
      clearTimeout(hintTimer)
      hintTimer = setTimeout(() => setHint(null), HINT_MS)
    }
    const onFocusIn = () => {
      map.scrollWheelZoom.enable()
      setHint(null)
    }
    const onFocusOut = (event: FocusEvent) => {
      if (!container.contains(event.relatedTarget as Node | null))
        map.scrollWheelZoom.disable()
    }
    const onWheel = () => {
      if (!map.scrollWheelZoom.enabled()) showHint('wheel')
    }
    const onTouchMove = (event: TouchEvent) => {
      if (coarse && event.touches.length === 1) showHint('touch')
    }

    // --- selecting a place ----------------------------------------------
    // One delegated listener for every bubble, so markers can be rebuilt
    // freely. A drag that starts on a bubble must not select it.
    let dragged = false
    const onPointerDown = () => {
      dragged = false
    }
    const onDragStart = () => {
      dragged = true
    }
    const onClick = (event: MouseEvent) => {
      const wasDragged = dragged
      dragged = false
      const target = event.target as Element | null
      const bubble = target?.closest<HTMLElement>('[data-pm-id]')
      // `detail === 0` is a keyboard activation (Enter/Space), never a drag.
      if (!bubble || (wasDragged && event.detail !== 0)) return
      const id = bubble.dataset.pmId
      if (id) onSelectRef.current?.(id)
    }

    container.addEventListener('focusin', onFocusIn)
    container.addEventListener('focusout', onFocusOut)
    container.addEventListener('wheel', onWheel, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: true })
    container.addEventListener('pointerdown', onPointerDown, true)
    container.addEventListener('click', onClick)
    map.on('dragstart', onDragStart)

    // The container can change size (the md breakpoint height, a sidebar).
    const resize = new ResizeObserver(() => map.invalidateSize())
    resize.observe(container)

    const markers = markersRef.current
    return () => {
      clearTimeout(hintTimer)
      resize.disconnect()
      container.removeEventListener('focusin', onFocusIn)
      container.removeEventListener('focusout', onFocusOut)
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('pointerdown', onPointerDown, true)
      container.removeEventListener('click', onClick)
      map.off('dragstart', onDragStart)
      map.remove()
      mapRef.current = null
      layerRef.current = null
      markers.clear()
    }
    // The control titles are read once; a language switch re-creates them
    // through the `key` the wrapper passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Basemap for the current theme; swapped live when the theme changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const config = PROJECTS_MAP_TILES[theme === 'dark' ? 'dark' : 'light']
    let loaded = 0
    let failed = 0
    setTilesFailed(false)
    const layer = L.tileLayer(config.url, {
      attribution: config.attribution,
      subdomains: config.subdomains,
      maxZoom: config.maxZoom,
    })
    layer.on('tileload', () => {
      loaded += 1
      if (failed > 0) setTilesFailed(false)
    })
    // The bubbles do not depend on the tiles: if the basemap cannot load
    // (offline, provider down), they still render on the plain surface and
    // a short note says why the background is empty.
    layer.on('tileerror', () => {
      failed += 1
      if (loaded === 0) setTilesFailed(true)
    })
    layer.addTo(map)
    return () => {
      layer.remove()
    }
  }, [theme])

  // Markers. Rebuilt when the points or the label language change; selection
  // is patched in place by the next effect.
  const bubbleTemplate = t('projectsMapBubbleLabel')
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const markers = markersRef.current
    markers.clear()

    const placed = placeablePoints(points)
    const maxCount = maxPointCount(placed)
    const sizes = new Map<string, number>()
    // Tab order follows the counts, largest first.
    const ordered = [...placed].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ar'),
    )
    for (const point of ordered) {
      const diameter = bubbleDiameter(point.count, maxCount)
      sizes.set(point.id, diameter)
      const selected = point.id === selectedRef.current
      const icon = L.divIcon({
        className: 'pm-marker',
        html: bubbleHtml({
          id: point.id,
          name: point.name,
          count: point.count,
          kind: point.kind,
          diameter,
          label: formatBubbleLabel(bubbleTemplate, point.name, point.count),
          selected,
        }),
        iconSize: [diameter, diameter],
        iconAnchor: [diameter / 2, diameter / 2],
      })
      const marker = L.marker([point.lat, point.lng], {
        icon,
        // The inner <button> is the interactive, focusable element.
        interactive: false,
        keyboard: false,
        zIndexOffset: stackingOffset(point.count, maxCount, selected),
      })
      layer.addLayer(marker)
      markers.set(point.id, marker)
    }

    // Names stay visible where they fit; overlapping ones wait for hover or
    // focus. Re-run after every zoom, since that changes the spacing.
    const placeLabels = () => {
      const candidates: LabelCandidate[] = []
      for (const point of placed) {
        const element = markers.get(point.id)?.getElement()
        const labelElement = element?.querySelector<HTMLElement>('.pm-label')
        const diameter = sizes.get(point.id)
        if (!element || !labelElement || diameter === undefined) continue
        const centre = map.latLngToContainerPoint([point.lat, point.lng])
        const radius = diameter / 2
        const width = labelElement.offsetWidth
        const height = labelElement.offsetHeight
        candidates.push({
          id: point.id,
          priority: point.count,
          bubble: {
            x: centre.x - radius,
            y: centre.y - radius,
            width: diameter,
            height: diameter,
          },
          label: {
            x: centre.x - width / 2,
            y: centre.y + radius + LABEL_GAP,
            width,
            height,
          },
        })
      }
      const visible = visibleLabelIds(candidates)
      for (const [id, marker] of markers)
        marker
          .getElement()
          ?.classList.toggle('pm-label-hidden', !visible.has(id))
    }
    placeLabels()
    map.on('zoomend', placeLabels)
    // Web fonts can arrive after the first measurement and widen the labels.
    let cancelled = false
    document.fonts?.ready.then(() => {
      if (!cancelled) placeLabels()
    })
    return () => {
      cancelled = true
      map.off('zoomend', placeLabels)
    }
  }, [points, bubbleTemplate])

  // Re-frame only when the drawn places change, not on a count refresh.
  const framingKey = viewKey(points)
  const framedKeyRef = useRef(framingKey)
  useEffect(() => {
    const map = mapRef.current
    if (!map || framedKeyRef.current === framingKey) return
    framedKeyRef.current = framingKey
    applyView(map, pointsRef.current)
  }, [framingKey])

  // Selection ring, pressed state and stacking, patched without a rebuild.
  useEffect(() => {
    const maxCount = maxPointCount(placeablePoints(pointsRef.current))
    for (const point of placeablePoints(pointsRef.current)) {
      const marker = markersRef.current.get(point.id)
      if (!marker) continue
      const selected = point.id === selectedId
      const bubble = marker.getElement()?.querySelector('.pm-bubble')
      bubble?.classList.toggle('is-selected', selected)
      bubble?.setAttribute('aria-pressed', selected ? 'true' : 'false')
      marker.setZIndexOffset(stackingOffset(point.count, maxCount, selected))
    }
  }, [selectedId, points, bubbleTemplate])

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        dir="ltr"
        role="region"
        aria-label={label}
        className="pm-map h-full w-full"
      />
      {(hint || tilesFailed) && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 top-3 z-[1000] flex justify-center px-14"
        >
          <p className="rounded-lg border bg-bg px-3 py-1.5 text-center text-xs text-fg shadow-sm">
            {hint === 'wheel'
              ? t('projectsMapWheelHint')
              : hint === 'touch'
                ? t('projectsMapTouchHint')
                : t('projectsMapTilesError')}
          </p>
        </div>
      )}
    </div>
  )
}
