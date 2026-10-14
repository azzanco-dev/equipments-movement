// Pure helpers for the «الموقع الحالي» map (src/components/map/LocationMap).
// Nothing here touches Leaflet, React or the DOM.

/**
 * Basemap tiles, one entry per theme. This is the single place to swap the
 * provider. The standard OpenStreetMap raster tiles need no API key (CARTO's
 * basemaps started answering "API key required" on 2026-10-07); their colours
 * are toned down, and inverted for the dark theme, by the CSS filters on
 * `.pm-map .leaflet-tile-pane` in src/index.css. OSM's tile usage policy
 * allows light use with the attribution kept visible; a heavier use needs a
 * paid provider (an owner decision before that point).
 */
const OSM_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  subdomains: '',
  maxZoom: 19,
} as const

export const LOCATION_MAP_TILES = {
  light: OSM_TILES,
  dark: OSM_TILES,
} as const

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escapes text for HTML content and double- or single-quoted attributes
 * (the marker's HTML goes through Leaflet's `divIcon`, outside React). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}
