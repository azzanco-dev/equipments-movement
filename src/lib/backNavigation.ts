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
 *
 * Owner 2026-11-11 («ازرار الرجوع مازالت فيها مشاكل … ابغاها ترجعني للصفحة
 * الي قبل بنفس الفلاتر فقط»): the router REMOUNTS the whole app on every
 * path change (the catch-all route is keyed by its path), so "is this the
 * first render of the tab" cannot live in a component — it did, every page
 * looked like a fresh start, the trail never held more than one page and
 * back always went to the parent list. That state now lives at module level
 * (`recordCurrentVisit`), and a visit is told apart by HOW it happened:
 * a link (`push`), the browser's back / forward (`pop`, seen on
 * `popstate`), or our own back button pushing a URL (`back`).
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
 * How the app came to show a URL:
 * - `first`: the first render of this tab load (a reload, a new tab, a link
 *   from outside);
 * - `push`: a link or a navigation by code;
 * - `pop`: the browser's back or forward (also our button's `history` plan);
 * - `back`: our back button pushed this URL (the page before, or the parent
 *   list when there was none).
 */
export type VisitKind = 'first' | 'push' | 'pop' | 'back'

/** A page that only leads somewhere else (the movement form opens the saved
 *  movement): back never returns to it. */
const TRANSIENT_PATHS: readonly string[] = ['/movements/new']

export function isTransientPath(path: string): boolean {
  return TRANSIENT_PATHS.includes(path)
}

/** The trail entry back leads to: the nearest page before the current one
 *  that is not transient; -1 when there is none. */
function backIndex(trail: readonly TrailEntry[]): number {
  let index = trail.length - 2
  while (index >= 0 && isTransientPath(trail[index].path)) index -= 1
  return index
}

/**
 * The trail after the app shows `url`. On `first` a reload of the same URL
 * keeps the trail and anything else (a new tab that copied the opener's
 * storage, a link from outside) starts over.
 */
export function nextTrail(
  trail: readonly TrailEntry[],
  url: string,
  kind: VisitKind,
): TrailEntry[] {
  const path = pathOf(url)
  const top = trail[trail.length - 1]
  const entry: TrailEntry = { url, path, merged: false }
  if (kind === 'first') return top && top.url === url ? [...trail] : [entry]
  if (top && top.url === url) return [...trail]
  if (kind === 'back' || kind === 'pop') {
    // Another browser entry of the page on top (it pushed its own query).
    if (kind === 'pop' && top && top.path === path)
      return [...trail.slice(0, -1), { url, path, merged: top.merged }]
    // A page of the trail is shown again: everything after it is left.
    for (let index = trail.length - 2; index >= 0; index -= 1)
      if (trail[index].url === url) return trail.slice(0, index + 1)
    // An earlier browser entry of a page that changed its query since.
    for (let index = trail.length - 2; index >= 0; index -= 1)
      if (trail[index].path === path && trail[index].merged)
        return [...trail.slice(0, index), { url, path, merged: true }]
    // Our button with no page before: the parent list starts the trail.
    if (kind === 'back') return [entry]
    // The browser's forward to a page the trail had left.
    return [...trail, entry].slice(-BACK_TRAIL_MAX)
  }
  // The same page with another query: the page itself changed.
  if (top && top.path === path)
    return [...trail.slice(0, -1), { url, path, merged: true }]
  // A link, even to the page before (PO → unit → the same PO again): the
  // browser adds an entry, so the trail does too.
  return [...trail, entry].slice(-BACK_TRAIL_MAX)
}

export type BackPlan = { kind: 'history' } | { kind: 'push'; url: string }

/** What the back button does: the browser's back to the page before (it
 *  returns as it was, with its filters), a push of that page's URL when the
 *  browser's own back would not land on it (this page changed its query, or a
 *  transient page sits in between), or a push of the parent list. */
export function planBack(
  trail: readonly TrailEntry[],
  fallbackUrl: string,
): BackPlan {
  const top = trail[trail.length - 1]
  const index = backIndex(trail)
  if (!top || index < 0) return { kind: 'push', url: fallbackUrl }
  return index === trail.length - 2 && !top.merged
    ? { kind: 'history' }
    : { kind: 'push', url: trail[index].url }
}

/** The path back leads to: the page before, else the parent list. */
export function backTargetPath(
  trail: readonly TrailEntry[],
  fallbackPath: string,
): string {
  const index = backIndex(trail)
  return index >= 0 ? trail[index].path : fallbackPath
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
export function recordVisit(url: string, kind: VisitKind): TrailEntry[] {
  const trail = nextTrail(readTrail(), url, kind)
  writeJson(BACK_TRAIL_KEY, trail)
  writeJson(LAST_URLS_KEY, nextLastUrls(readLastUrls(), url))
  return trail
}

// --- This tab load (module level: it survives the app's remounts) ------------

let firstVisit = true
/** The URL the browser's back / forward last landed on, until it is recorded. */
let poppedUrl: string | null = null
/** The URL our back button pushed, until it is recorded. */
let backPushUrl: string | null = null
let listening = false

/** Path plus query in the form the app builds its URL (`URLSearchParams`'s
 *  own encoding), so the two compare equal. */
function locationUrl(): string {
  const query = new URLSearchParams(window.location.search).toString()
  return query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname
}

function listenForPop() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('popstate', () => {
    poppedUrl = locationUrl()
  })
}

/** The back button is about to push `url` (`planBack`'s push plan). */
export function noteBackPush(url: string) {
  backPushUrl = url
}

/**
 * Records that the app shows `url` now, working out how it got there. Called
 * from the app's effect on every URL change; safe to call twice for one URL.
 */
export function recordCurrentVisit(url: string): TrailEntry[] {
  listenForPop()
  const kind: VisitKind = firstVisit
    ? 'first'
    : backPushUrl === url
      ? 'back'
      : poppedUrl === url
        ? 'pop'
        : 'push'
  firstVisit = false
  poppedUrl = null
  backPushUrl = null
  return recordVisit(url, kind)
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
