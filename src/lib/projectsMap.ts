// Pure helpers for the projects map (src/components/map). Nothing here
// touches Leaflet, React or the DOM, so the sizing, framing, label and
// collision rules are unit-tested in tests/projects-map.test.cjs.

export type ProjectsMapKind = 'project' | 'workshop'

export interface ProjectsMapPoint {
  id: string
  name: string
  lat: number
  lng: number
  /** Units inside this place right now. */
  count: number
  kind: ProjectsMapKind
}

/** A project with units inside but no saved location. */
export interface ProjectsMapUnplaced {
  id: string
  name: string
  count: number
}

/**
 * Basemap tiles, one entry per theme. This is the single place to swap the
 * provider. CARTO's Positron and Dark Matter are muted enough for the neutral
 * palette; their usage terms are an owner decision before production.
 */
export const PROJECTS_MAP_TILES = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  },
} as const

/** Riyadh city centre, used when there is nothing to frame. */
export const RIYADH_CENTER: readonly [number, number] = [24.7136, 46.6753]
export const RIYADH_ZOOM = 10
/** Zoom used when there is a single point (a zero-size bounds). */
export const SINGLE_POINT_ZOOM = 13
/** Fitting never zooms closer than this, even for tightly grouped points. */
export const FIT_MAX_ZOOM = 14

/** Bubble diameter range in CSS pixels. 34 px keeps a 3-digit count legible
 * and stays above the 24 px minimum touch target. */
export const BUBBLE_MIN_DIAMETER = 34
export const BUBBLE_MAX_DIAMETER = 64

/**
 * Bubble diameter for `count`, on a square-root scale so the bubble's AREA
 * tracks the count: the largest count gets `max`, a count a quarter of it gets
 * half the diameter. Small counts are clamped up to `min` so they stay
 * readable and tappable. Non-finite or non-positive input gives `min`.
 */
export function bubbleDiameter(
  count: number,
  maxCount: number,
  min = BUBBLE_MIN_DIAMETER,
  max = BUBBLE_MAX_DIAMETER,
): number {
  if (!Number.isFinite(count) || !Number.isFinite(maxCount)) return min
  if (count <= 0 || maxCount <= 0) return min
  const ratio = Math.sqrt(Math.min(count, maxCount) / maxCount)
  return Math.round(Math.max(min, Math.min(max, max * ratio)))
}

/** Largest count among the points, 0 for none. */
export function maxPointCount(points: readonly ProjectsMapPoint[]): number {
  return points.reduce(
    (max, point) => (point.count > max ? point.count : max),
    0,
  )
}

function isValidCoordinate(point: Pick<ProjectsMapPoint, 'lat' | 'lng'>) {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  )
}

/** Points with a usable latitude/longitude; the rest cannot be drawn. */
export function placeablePoints(
  points: readonly ProjectsMapPoint[],
): ProjectsMapPoint[] {
  return points.filter(isValidCoordinate)
}

export type ProjectsMapView =
  | { kind: 'center'; center: [number, number]; zoom: number }
  | {
      kind: 'bounds'
      /** [[south, west], [north, east]], as Leaflet's fitBounds expects. */
      bounds: [[number, number], [number, number]]
    }

/**
 * The initial (and "reset") view: frame every placeable point, centre on a
 * single point, or fall back to Riyadh when there is none.
 */
export function initialView(
  points: readonly ProjectsMapPoint[],
): ProjectsMapView {
  const placed = placeablePoints(points)
  if (placed.length === 0)
    return {
      kind: 'center',
      center: [RIYADH_CENTER[0], RIYADH_CENTER[1]],
      zoom: RIYADH_ZOOM,
    }
  let south = Infinity
  let west = Infinity
  let north = -Infinity
  let east = -Infinity
  for (const point of placed) {
    south = Math.min(south, point.lat)
    north = Math.max(north, point.lat)
    west = Math.min(west, point.lng)
    east = Math.max(east, point.lng)
  }
  if (south === north && west === east)
    return { kind: 'center', center: [south, west], zoom: SINGLE_POINT_ZOOM }
  return {
    kind: 'bounds',
    bounds: [
      [south, west],
      [north, east],
    ],
  }
}

/**
 * Changes only when the drawn positions change, so the map re-frames itself
 * when places are added or moved but not when only a count refreshes (which
 * would throw away the user's pan and zoom).
 */
export function viewKey(points: readonly ProjectsMapPoint[]): string {
  return placeablePoints(points)
    .map((point) => `${point.id}@${point.lat},${point.lng}`)
    .sort()
    .join('|')
}

/** Fills a `{name}` / `{count}` template, e.g. «القدية: 41 معدة». */
export function formatBubbleLabel(
  template: string,
  name: string,
  count: number,
): string {
  return template
    .replace('{name}', name.trim())
    .replace('{count}', String(count))
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escapes text for HTML content and double- or single-quoted attributes. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

export interface BubbleHtmlInput {
  id: string
  name: string
  count: number
  kind: ProjectsMapKind
  diameter: number
  /** Accessible name, already formatted (see `formatBubbleLabel`). */
  label: string
  selected: boolean
}

/**
 * The marker's HTML (Leaflet `divIcon`). A real <button> so it is reachable
 * by Tab and announced with its accessible name; the visible count and the
 * place name are hidden from assistive technology because the name already
 * carries both. Styling lives in the "Projects map" block of src/index.css.
 */
export function bubbleHtml(input: BubbleHtmlInput): string {
  const digits = String(input.count).length
  const size = Math.round(input.diameter)
  return (
    `<button type="button" class="pm-bubble pm-bubble--${input.kind}${
      input.selected ? ' is-selected' : ''
    }${digits >= 3 ? ' pm-bubble--long' : ''}"` +
    ` data-pm-id="${escapeHtml(input.id)}"` +
    ` aria-label="${escapeHtml(input.label)}"` +
    ` aria-pressed="${input.selected ? 'true' : 'false'}"` +
    ` style="width:${size}px;height:${size}px">` +
    `<span class="pm-count" aria-hidden="true">${input.count}</span>` +
    `</button>` +
    `<span class="pm-label" dir="auto" aria-hidden="true">${escapeHtml(
      input.name.trim(),
    )}</span>`
  )
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  )
}

export interface LabelCandidate {
  id: string
  /** Higher keeps its label first (the unit count). */
  priority: number
  /** Where the name label would be drawn, in container pixels. */
  label: Rect
  /** The bubble's bounding box, in container pixels. */
  bubble: Rect
}

/**
 * Greedy label placement: going from the highest priority down (ties by id,
 * so the result is stable), a label is shown when it overlaps neither an
 * already shown label nor another place's bubble. Hidden labels still appear
 * on hover/focus and the name is always in the bubble's accessible name.
 * Returns the ids whose label is shown.
 */
export function visibleLabelIds(
  candidates: readonly LabelCandidate[],
  gap = 2,
): Set<string> {
  const ordered = [...candidates].sort(
    (a, b) =>
      b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const shown: Rect[] = []
  const ids = new Set<string>()
  for (const candidate of ordered) {
    const hitsLabel = shown.some((rect) =>
      rectsOverlap(candidate.label, rect, gap),
    )
    const hitsBubble = candidates.some(
      (other) =>
        other.id !== candidate.id &&
        rectsOverlap(candidate.label, other.bubble, gap),
    )
    if (hitsLabel || hitsBubble) continue
    shown.push(candidate.label)
    ids.add(candidate.id)
  }
  return ids
}

/**
 * Marker stacking: smaller bubbles sit above larger ones so an overlapped
 * small place stays clickable; the selected place is always on top.
 */
export function stackingOffset(
  count: number,
  maxCount: number,
  selected: boolean,
): number {
  const base = Math.max(0, Math.round((maxCount - count) * 10))
  return selected ? base + 100000 : base
}

/** Total units per kind, unplaced projects counted as projects. */
export function totalsByKind(
  points: readonly ProjectsMapPoint[],
  unplaced: readonly ProjectsMapUnplaced[] = [],
): Record<ProjectsMapKind, number> {
  const totals: Record<ProjectsMapKind, number> = { project: 0, workshop: 0 }
  for (const point of points) totals[point.kind] += point.count
  for (const row of unplaced) totals.project += row.count
  return totals
}
