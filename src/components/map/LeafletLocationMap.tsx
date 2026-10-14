'use client'

import { useEffect, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useI18n } from '@/i18n/I18nContext'
import { useTheme } from '@/theme/ThemeContext'
import { LOCATION_MAP_TILES, escapeHtml } from '@/lib/locationMap'

/**
 * The Leaflet half of `LocationMap` (wave 17, the «الموقع الحالي» card).
 * Only `./LocationMap` imports this file, and only through a dynamic import
 * started in an effect, so Leaflet (and its stylesheet) is downloaded when a
 * map is actually on screen and is never evaluated on the server (Leaflet
 * reads `window` when it loads). It stays the ONLY file that imports Leaflet.
 */
export interface LeafletLocationMapProps {
  lat: number
  lng: number
  /** Accessible name of the map region. */
  label: string
  /** Accessible name of the marker. */
  markerLabel: string
}

/** Street level: close enough to read the site, far enough to see roads. */
const LOCATION_ZOOM = 15
const LOCATION_MARKER_SIZE = 22

/**
 * A single marker on the themed basemap: the last position of an
 * equipment's tracker unit. The page is RTL, but Leaflet lays out panes and
 * controls by left/top; the container itself is `dir="ltr"`, and the controls
 * go to the page's start side (the zoom) and end side (the attribution).
 * Wheel zoom only once the map has focus, so scrolling the page past the map
 * never zooms it by accident; on touch screens one finger keeps scrolling the
 * page while two fingers pan and pinch the map.
 */
export function LeafletLocationMap({
  lat,
  lng,
  label,
  markerLabel,
}: LeafletLocationMapProps) {
  const { t } = useI18n()
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const positionRef = useRef<[number, number]>([lat, lng])
  const [tilesFailed, setTilesFailed] = useState(false)
  positionRef.current = [lat, lng]

  // Strings the Leaflet controls read once, at creation.
  const zoomInTitle = t('projectsMapZoomIn')
  const zoomOutTitle = t('projectsMapZoomOut')

  // Create the map once per mount. React 18 StrictMode mounts twice in
  // development; `map.remove()` in the cleanup clears Leaflet's id from the
  // container, so the second mount starts from a clean element.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
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
      scrollWheelZoom: false,
      dragging: !coarse,
      touchZoom: true,
      minZoom: 5,
      maxZoom: 18,
      zoomSnap: 1,
    })
    mapRef.current = map
    L.control
      .zoom({
        position: pageDir === 'rtl' ? 'topright' : 'topleft',
        zoomInTitle,
        zoomOutTitle,
      })
      .addTo(map)
    L.control
      .attribution({
        position: pageDir === 'rtl' ? 'bottomleft' : 'bottomright',
        prefix: false,
      })
      .addTo(map)
    const half = LOCATION_MARKER_SIZE / 2
    markerRef.current = L.marker(positionRef.current, {
      icon: L.divIcon({
        className: 'pm-marker',
        html: `<span class="pm-location" role="img" aria-label="${escapeHtml(markerLabel)}"></span>`,
        iconSize: [LOCATION_MARKER_SIZE, LOCATION_MARKER_SIZE],
        iconAnchor: [half, half],
      }),
      interactive: false,
      keyboard: false,
    }).addTo(map)
    map.setView(positionRef.current, LOCATION_ZOOM)

    const onFocusIn = () => map.scrollWheelZoom.enable()
    const onFocusOut = (event: FocusEvent) => {
      if (!container.contains(event.relatedTarget as Node | null))
        map.scrollWheelZoom.disable()
    }
    container.addEventListener('focusin', onFocusIn)
    container.addEventListener('focusout', onFocusOut)
    // The container can change size (the md breakpoint height, a sidebar).
    const resize = new ResizeObserver(() => map.invalidateSize())
    resize.observe(container)
    return () => {
      resize.disconnect()
      container.removeEventListener('focusin', onFocusIn)
      container.removeEventListener('focusout', onFocusOut)
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // Created once per mount; the wrapper's `key` re-creates the map when the
    // language changes (control titles, marker label).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A new reading moves the marker and re-centres the map.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markerRef.current?.setLatLng([lat, lng])
    map.setView([lat, lng], map.getZoom() || LOCATION_ZOOM)
  }, [lat, lng])

  // Basemap for the current theme; swapped live when the theme changes. The
  // marker does not depend on the tiles: if the basemap cannot load (offline,
  // provider down), it still renders on the plain surface and a short note
  // says why the background is empty.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const config = LOCATION_MAP_TILES[theme === 'dark' ? 'dark' : 'light']
    let loaded = 0
    setTilesFailed(false)
    const layer = L.tileLayer(config.url, {
      attribution: config.attribution,
      subdomains: config.subdomains,
      maxZoom: config.maxZoom,
    })
    layer.on('tileload', () => {
      loaded += 1
      setTilesFailed(false)
    })
    layer.on('tileerror', () => {
      if (loaded === 0) setTilesFailed(true)
    })
    layer.addTo(map)
    return () => {
      layer.remove()
    }
  }, [theme])

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        dir="ltr"
        role="region"
        aria-label={label}
        className="pm-map h-full w-full"
      />
      {tilesFailed && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 top-3 z-[1000] flex justify-center px-14"
        >
          <p className="rounded-lg border bg-bg px-3 py-1.5 text-center text-xs text-fg shadow-sm">
            {t('projectsMapTilesError')}
          </p>
        </div>
      )}
    </div>
  )
}
