import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  AppLink,
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  type BadgeTone,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { activityActorFilterOptions } from '@/lib/activityActorFilter'
import {
  ACTIVITY_LOG_SELECT,
  activityChanges,
  activityColumnFilterKeys,
  activityFieldFilterValues,
  activityFieldLabelKey,
  activityFieldsCountKey,
  activityHref,
  activityKindOf,
  formatActivityValue,
  legacyActivityParams,
  withActivityKind,
  type ActivityAction,
  type ActivityChange,
  type ActivityKind,
  type ActivityLogRow,
} from '@/lib/activityLog'
import { applyListFilters } from '@/lib/applyListFilters'
import { formatDateTime } from '@/lib/dateFormat'
import { elapsedInWords } from '@/lib/elapsedWords'
import { activityListConfig } from '@/lib/listConfigs'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'

// «سجل النشاط» (owner 2026-11-02, approved on /ui-kit «نموذج صفحة النشاط
// الجديدة»): one list over the movement log and the equipment change log
// (migration 0168), read through the view `activity_log` (migration 0170)
// by the unified list system — search, filters, sort and paging on the
// server, the state in the URL. The approved main-list table look, a row
// that expands to every changed field, and one card per row on phones. The
// «سجل التعديلات» card of the equipment page was EXCLUDED by the owner.

const CHIPS_SHOWN = 3

const KIND_LABEL: Record<ActivityKind, TranslationKey> = {
  movement: 'activityKindMovement',
  equipment: 'activityKindEquipment',
}

const ACTION_LABEL: Record<ActivityAction, TranslationKey> = {
  create: 'activityCreated',
  update: 'activityUpdated',
  delete: 'activityDeleted',
}

// Green for a creation, neutral for an edit, red only for a deletion
// (AGENTS.md: red is for errors and destructive actions).
const ACTION_TONE: Record<ActivityAction, BadgeTone> = {
  create: 'success',
  update: 'neutral',
  delete: 'danger',
}

/** The kind switch's tabs; «الكل» removes the kind filter. */
const KIND_TABS: { id: 'all' | ActivityKind; label: TranslationKey }[] = [
  { id: 'all', label: 'all' },
  { id: 'movement', label: 'activityKindMovements' },
  { id: 'equipment', label: 'activityKindEquipments' },
]

type Translate = (key: TranslationKey) => string

function fieldLabel(row: ActivityLogRow, key: string, t: Translate): string {
  const labelKey = activityFieldLabelKey(row.kind, key)
  return labelKey ? t(labelKey) : key
}

/** The muted line under the code: the movement, or what changed on the
 *  unit. */
function recordLine(row: ActivityLogRow, t: Translate): string {
  if (row.kind === 'movement') {
    const type = row.movement_type ? t(row.movement_type) : null
    const context =
      row.movement_context === 'site'
        ? t('activityContextSite')
        : row.movement_context === 'workshop'
          ? t('workshopLocation')
          : null
    return [type, context].filter(Boolean).join(' · ')
  }
  if (row.action === 'create') return t('activityNewEquipment')
  if (row.action === 'delete') return t('activityEquipmentDeleted')
  const count = row.changed_fields?.length ?? 0
  return t(activityFieldsCountKey(count)).replace('{count}', String(count))
}

function sinceWords(at: string, lang: 'ar' | 'en', t: Translate): string {
  const words = elapsedInWords(at, lang)
  return words ? t('activitySince').replace('{words}', words) : ''
}

/** «الحالة: نشطة ← مباعة» — the arrow points at the new value in the
 *  reading direction; a creation shows the value alone, a deletion the old
 *  value alone. */
function Chip({
  row,
  change,
  lang,
  t,
}: {
  row: ActivityLogRow
  change: ActivityChange
  lang: 'ar' | 'en'
  t: Translate
}) {
  const arrow = lang === 'ar' ? '←' : '→'
  const hasBefore = change.before !== null && change.before !== undefined
  const hasAfter = change.after !== null && change.after !== undefined
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface-hover px-1.5 py-0.5 text-xs leading-4">
      <span className="text-muted">{fieldLabel(row, change.key, t)}:</span>
      {hasBefore && (
        <span className={cn('truncate', hasAfter && 'text-muted')} dir="auto">
          {formatActivityValue(row.kind, change.key, change.before, t)}
        </span>
      )}
      {hasBefore && hasAfter && (
        <span aria-hidden="true" className="text-muted">
          {arrow}
        </span>
      )}
      {hasAfter && (
        <span className="truncate font-medium" dir="auto">
          {formatActivityValue(row.kind, change.key, change.after, t)}
        </span>
      )}
      {!hasBefore && !hasAfter && <span className="text-muted">—</span>}
    </span>
  )
}

function Chips({
  row,
  lang,
  t,
}: {
  row: ActivityLogRow
  lang: 'ar' | 'en'
  t: Translate
}) {
  const changes = activityChanges(row)
  const shown = changes.slice(0, CHIPS_SHOWN)
  const rest = changes.length - shown.length
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((change) => (
        <Chip key={change.key} row={row} change={change} lang={lang} t={t} />
      ))}
      {rest > 0 && (
        <span className="rounded-md border px-1.5 py-0.5 text-xs leading-4 text-muted">
          +{rest}
        </span>
      )}
    </span>
  )
}

function TimeCell({
  at,
  lang,
  t,
}: {
  at: string
  lang: 'ar' | 'en'
  t: Translate
}) {
  return (
    <span className="flex flex-col">
      <span className="tabular-nums">{formatDateTime(at)}</span>
      <span className="text-xs text-muted">{sinceWords(at, lang, t)}</span>
    </span>
  )
}

function KindCell({ row, t }: { row: ActivityLogRow; t: Translate }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Badge size="sm" tone={ACTION_TONE[row.action]}>
        {t(KIND_LABEL[row.kind])}
      </Badge>
      <span className="text-xs text-muted">{t(ACTION_LABEL[row.action])}</span>
    </span>
  )
}

/** The identity cell: the code in bold as a real link to the movement or the
 *  unit (plain text for a deleted record), the movement or the field count
 *  under it. */
function RecordCell({ row, t }: { row: ActivityLogRow; t: Translate }) {
  const href = activityHref(row)
  const code = row.equipment_code ?? '—'
  return (
    <span className="flex flex-col">
      {href ? (
        <AppLink
          href={href}
          className="w-fit font-semibold hover:underline"
          dir="ltr"
        >
          {code}
        </AppLink>
      ) : (
        <span className="w-fit font-semibold" dir="ltr">
          {code}
        </span>
      )}
      <span className="text-xs text-muted">{recordLine(row, t)}</span>
    </span>
  )
}

/** Every changed field, before and after, under the expanded row and in the
 *  phone card's details. */
function ChangesPanel({
  row,
  lang,
  t,
}: {
  row: ActivityLogRow
  lang: 'ar' | 'en'
  t: Translate
}) {
  const arrow = lang === 'ar' ? '←' : '→'
  const href = activityHref(row)
  const changes = activityChanges(row)
  return (
    <div className="space-y-3 p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          {t(KIND_LABEL[row.kind])} · {t(ACTION_LABEL[row.action])} ·{' '}
          {row.actor_name ?? t('system')} · {formatDateTime(row.created_at)}
        </span>
        {href && (
          <AppLink href={href} className="font-medium text-fg hover:underline">
            {row.kind === 'movement'
              ? t('siteUnitsOpenMovement')
              : t('activityEquipmentPage')}
          </AppLink>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border bg-bg">
        <div className="grid grid-cols-[1fr_1.3fr_auto_1.3fr] items-center gap-2 border-b bg-surface px-3 py-1.5 text-xs text-muted">
          <span>{t('activityFieldFilter')}</span>
          <span>{t('activityBefore')}</span>
          <span aria-hidden="true" />
          <span>{t('activityAfter')}</span>
        </div>
        {changes.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted">—</p>
        )}
        {changes.map((change) => (
          <div
            key={change.key}
            className="grid grid-cols-[1fr_1.3fr_auto_1.3fr] items-center gap-2 border-b px-3 py-2 last:border-0"
          >
            <span className="font-medium">
              {fieldLabel(row, change.key, t)}
            </span>
            <span
              className="whitespace-normal break-words text-muted"
              dir="auto"
            >
              {formatActivityValue(row.kind, change.key, change.before, t)}
            </span>
            <span aria-hidden="true" className="text-muted">
              {arrow}
            </span>
            <span
              className="whitespace-normal break-words font-medium"
              dir="auto"
            >
              {formatActivityValue(row.kind, change.key, change.after, t)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The phone layout: one card per row, the details folded under it. */
function ActivityCard({
  row,
  lang,
  t,
}: {
  row: ActivityLogRow
  lang: 'ar' | 'en'
  t: Translate
}) {
  const [open, setOpen] = useState(false)
  return (
    <article className="space-y-2 rounded-lg border bg-bg p-3 text-[13px]">
      <div className="flex items-start justify-between gap-2">
        <RecordCell row={row} t={t} />
        <KindCell row={row} t={t} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
        <span>{row.actor_name ?? t('system')}</span>
        <span className="tabular-nums">{formatDateTime(row.created_at)}</span>
        <span>{sinceWords(row.created_at, lang, t)}</span>
      </div>
      <Chips row={row} lang={lang} t={t} />
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        icon={
          open ? (
            <ChevronUp size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )
        }
        onClick={() => setOpen((value) => !value)}
      >
        {open ? t('activityHideDetails') : t('activityAllChanges')}
      </Button>
      {open && (
        <div className="-mx-3 -mb-3 border-t bg-surface">
          <ChangesPanel row={row} lang={lang} t={t} />
        </div>
      )}
    </article>
  )
}

/** The rebuilt activity page at /activity (movements.activity). */
export function ActivityScreen() {
  const { t, lang } = useI18n()
  const pathname = usePathname()
  const params = useSearchParams()
  const list = useDataListState(activityListConfig)
  const [rows, setRows] = useState<ActivityLogRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // The old page's `action` / `context` parameters (the Settings card and
  // older deep links) and the mockup's `kind` become the list's `filters`
  // once, in place; `q` and `page` keep their names.
  useEffect(() => {
    const next = legacyActivityParams(new URLSearchParams(params.toString()))
    if (!next) return
    const query = next.toString()
    window.history.replaceState(
      null,
      '',
      query ? `${pathname}?${query}` : pathname,
    )
  }, [params, pathname])

  // Stable per language, so the filter control does not reload on each
  // render.
  const asyncFields = useMemo(
    () => ({ actor_id: activityActorFilterOptions(supabase, t('system')) }),
    [t],
  )

  const kind = activityKindOf(list.filters)

  const startListRequest = useListRequest()
  const fetchRows = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(false)
    let query = supabase
      .from('activity_log')
      .select(ACTIVITY_LOG_SELECT, { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
    // Newest first within the same sort value, then the log row's id:
    // deterministic paging over the two unioned logs.
    if (list.sort !== 'created_at')
      query = query.order('created_at', { ascending: false })
    query = query
      .order('source_id', { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      activityListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    query = applyListFilters(
      query,
      list.filters,
      activityColumnFilterKeys(activityListConfig),
    )
    // «الحقل»: the rows that changed any of the ticked fields.
    const fields = activityFieldFilterValues(list.filters)
    if (fields.length) query = query.overlaps('changed_fields', fields)
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) {
      console.error('Activity log load failed', error)
      setLoadError(true)
    }
    setRows((data as unknown as ActivityLogRow[] | null) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [
    list.direction,
    list.filters,
    list.page,
    list.pageSize,
    list.search,
    list.sort,
    startListRequest,
  ])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  const filtered = Boolean(list.search.trim()) || list.filters.length > 0

  const columns: DataTableColumn<ActivityLogRow>[] = [
    {
      key: 'created_at',
      header: t('activityColTime'),
      sortable: true,
      width: '11rem',
      cell: (row) => <TimeCell at={row.created_at} lang={lang} t={t} />,
    },
    {
      key: 'actor_name',
      header: t('user'),
      width: '10rem',
      cell: (row) => (
        <span className={cn(!row.actor_name && 'text-muted')}>
          {row.actor_name ?? t('system')}
        </span>
      ),
    },
    {
      key: 'kind',
      header: t('activityKindFilter'),
      width: '6rem',
      cell: (row) => <KindCell row={row} t={t} />,
    },
    {
      key: 'equipment_code',
      header: t('activityColRecord'),
      sortable: true,
      width: '10rem',
      cell: (row) => <RecordCell row={row} t={t} />,
    },
    {
      key: 'changes',
      header: t('activityColChanges'),
      className: 'whitespace-normal',
      cell: (row) => <Chips row={row} lang={lang} t={t} />,
    },
  ]

  const kindSwitch = (
    <Tabs
      value={kind ?? 'all'}
      onValueChange={(value) =>
        list.setFilters(
          withActivityKind(
            list.filters,
            value === 'all' ? null : (value as ActivityKind),
          ),
        )
      }
    >
      <TabsList variant="segmented" aria-label={t('activityKindFilter')}>
        {KIND_TABS.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {t(tab.label)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )

  return (
    <div className="space-y-4">
      <PageHeader title={t('activityLog')} description={t('activityLogDesc')} />
      <DataListToolbar
        config={activityListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filterFields={activityListConfig.filterFields}
        filters={list.filters}
        onFilters={list.setFilters}
        asyncFields={asyncFields}
        actions={kindSwitch}
      />

      {loadError ? (
        <ErrorState description={t('activityLoadError')} onRetry={fetchRows} />
      ) : (
        <>
          {/* From md up: the approved main-list table, a row expands to
              every changed field. */}
          <div className="hidden md:block">
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              sort={{
                key: list.sort,
                direction: list.direction,
              }}
              onSortChange={(key, direction) => list.setSort(key, direction)}
              loading={loading}
              loadingRows={8}
              cellTextClassName="text-[13px]"
              cellClassName="py-2"
              caption={t('activityLog')}
              expandable={{
                render: (row) => <ChangesPanel row={row} lang={lang} t={t} />,
              }}
              empty={filtered ? t('activityEmptyFiltered') : t('noActivity')}
            />
          </div>

          {/* Phones: one card per row. */}
          <div className="space-y-2 md:hidden">
            {loading && rows.length === 0 ? (
              <div className="space-y-2" aria-busy="true">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-28 w-full rounded-lg" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                title={filtered ? t('activityEmptyFiltered') : t('noActivity')}
              />
            ) : (
              <div
                className={cn(
                  'space-y-2',
                  loading && 'pointer-events-none opacity-60',
                )}
              >
                {rows.map((row) => (
                  <ActivityCard key={row.id} row={row} lang={lang} t={t} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {!loadError && total > 0 && (
        <DataListPagination
          page={list.page}
          pageSize={list.pageSize}
          total={total}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      )}
    </div>
  )
}
