/**
 * The context tabs of the movement log («المشاريع / الورشة / الكل») follow the
 * reader's `movements.read` scope (owner 2026-10-29, «فلتر المشاريع الورشة
 * الكل، برضه يكون خاضع للصلاحية»): a tab is offered only when the scope can
 * return rows of it beyond the reader's own. RLS (`movement_scope_allows`)
 * still decides the rows; this only stops offering a tab that would show
 * nothing but the reader's own movements.
 *
 * - `all`: the three tabs, as before.
 * - `site`, `companies` (project rows of his companies): «المشاريع» only.
 * - `workshop`: «الورشة» only.
 * - `own`, or no scope: the three tabs — his own rows can be of either
 *   context, and RLS returns only those.
 */
export type LogsTab = 'site' | 'workshop' | 'all'

export const LOGS_TABS: readonly LogsTab[] = ['site', 'workshop', 'all']

export function isLogsTab(value: string | null | undefined): value is LogsTab {
  return value === 'site' || value === 'workshop' || value === 'all'
}

export function logsTabsForScope(scope: string | null | undefined): LogsTab[] {
  if (scope === 'site' || scope === 'companies') return ['site']
  if (scope === 'workshop') return ['workshop']
  return [...LOGS_TABS]
}

/** The tab when allowed, else the first allowed one. */
export function clampLogsTab(
  tab: LogsTab,
  allowed: readonly LogsTab[],
): LogsTab {
  return allowed.includes(tab) ? tab : (allowed[0] ?? tab)
}
