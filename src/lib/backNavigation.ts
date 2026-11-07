/**
 * The one back rule (owner 2026-11-07, «نبغى نضبط ازرار الرجوع الي عندنا
 * كلها», approved on /ui-kit «المسار وازرار الرجوع», variant «ب»):
 *
 * - came here from another page of the app → back returns to that page as
 *   it was (the list with its search, filters and page — they live in the
 *   URL; the PO page you opened a unit from);
 * - opened directly (a new tab, a pasted or shared link, a reload with no
 *   earlier page) → back goes to the page's parent list, with the filters it
 *   last had in this tab.
 *
 * The app keeps its own small trail of the URLs visited in this tab
 * (sessionStorage), because the browser does not tell a page whether the
 * entry before it belongs to the app. The pure functions below decide; the
 * storage wrappers never throw (private mode, blocked storage) and the rule
 * then falls back to the parent list.
 */

export interface TrailEntry {
  /** Path plus query, e.g. `/purchasing/orders?filters=…`. */
  url: string
  path: string
  /** The query changed on this page after it was entered (a filter, a tab):
   *  the browser may hold extra entries for it, so back navigates to the
   *  previous URL instead of stepping through them. */
  merged: boolean
}

export const BACK_TRAIL_KEY = 'nav:trail'
export const LAST_URLS_KEY = 'nav:lastUrls'
/** The trail keeps the latest pages only. */
export const BACK_TRAIL_MAX = 50
export const LAST_URLS_MAX = 100

export function pathOf(url: string): string {
  const index = url.indexOf('?')
  return index < 0 ? url : url.slice(0, index)
}

/**
 * The trail after the app shows `url`. `first` is the app's first render in
 * this tab load: a reload of the same URL keeps the trail, anything else (a
 * new tab that copied the opener's storage, a link from outside) starts over.
 */
export function nextTrail(
  trail: readonly TrailEntry[],
  url: string,
  first: boolean,
): TrailEntry[] {
  const path = pathOf(url)
  const top = trail[trail.length - 1]
  if (first)
    return top && top.url === url
      ? [...trail]
      : [{ url, path, merged: false }]
  if (top && top.url === url) return [...trail]
  const previous = trail[trail.length - 2]
  // Back (the browser's button or ours): the page before is shown again.
  if (previous && previous.url === url) return trail.slice(0, -1)
  // The same page with another query: the page itself changed.
  if (top && top.path === path)
    return [...trail.slice(0, -1), { url, path, merged: true }]
  return [...trail, { url, path, merged: false }].slice(-BACK_TRAIL_MAX)
}

export type BackPlan = { kind: 'history' } | { kind: 'push'; url: string }

/** What the back button does: the browser's back to the page before, or a
 *  push of the parent list. */
export function planBack(
  trail: readonly TrailEntry[],
  fallbackUrl: string,
): BackPlan {
  const top = trail[trail.length - 1]
  const previous = trail[trail.length - 2]
  if (top && previous)
    return top.merged
      ? { kind: 'push', url: previous.url }
      : { kind: 'history' }
  return { kind: 'push', url: fallbackUrl }
}

/** The path back leads to: the page before, else the parent list. */
export function backTargetPath(
  trail: readonly TrailEntry[],
  fallbackPath: string,
): string {
  return trail.length >= 2 ? trail[trail.length - 2].path : fallbackPath
}

/** The URL a list was last shown with in this tab (its filters), else the
 *  bare path. */
export function rememberedUrl(
  lastUrls: Readonly<Record<string, string>>,
  path: string,
): string {
  return lastUrls[path] ?? path
}

// --- Storage (sessionStorage: this tab only) ---------------------------------

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable: back then goes to the parent list.
  }
}

export function readTrail(): TrailEntry[] {
  const value = readJson<unknown>(BACK_TRAIL_KEY, [])
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is TrailEntry =>
          typeof entry?.url === 'string' && typeof entry?.path === 'string',
      )
    : []
}

export function readLastUrls(): Record<string, string> {
  const value = readJson<unknown>(LAST_URLS_KEY, {})
  return value && typeof value === 'object'
    ? (value as Record<string, string>)
    : {}
}

/** Records that the app shows `url`; returns the new trail. */
export function recordVisit(url: string, first: boolean): TrailEntry[] {
  const trail = nextTrail(readTrail(), url, first)
  writeJson(BACK_TRAIL_KEY, trail)
  writeJson(LAST_URLS_KEY, nextLastUrls(readLastUrls(), url))
  return trail
}

/** The latest URL of each path, the newest last, at most 100 paths. */
export function nextLastUrls(
  lastUrls: Readonly<Record<string, string>>,
  url: string,
): Record<string, string> {
  const path = pathOf(url)
  const entries = Object.entries(lastUrls).filter(([key]) => key !== path)
  entries.push([path, url])
  return Object.fromEntries(entries.slice(-LAST_URLS_MAX))
}
