import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { PageHeader } from '@/components/PageHeader'
import { MovementLogCard } from '@/components/MovementLogCard'
import { ReportListSkeleton } from '@/components/ReportListSkeleton'
import { Alert } from '@/components/Alert'
import {
  buildSearchFilter,
  COMPANY_PROJECT_SEARCH_FIELDS,
  DRIVER_SEARCH_FIELDS,
  EQUIPMENT_CODE_TYPE_SEARCH_FIELDS,
  sanitizeSearchTerm,
} from '@/lib/search'
import { unwrapRows } from '@/lib/supabaseResult'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import {
  fetchProfileNames,
  withSupervisorNames,
} from '@/components/details/profileNames'
import { OwnerContextFilter } from '@/components/OwnerContextFilter'
import type { AdminHomeOwner } from '@/lib/adminHomeStats'
import {
  applyReportFilterParams,
  parseReportContext,
  parseReportOwners,
  type ReportContext,
} from '@/lib/reportFilters'
import {
  isDateKey,
  saudiDateKey,
  saudiDayEnd,
  saudiDayStart,
  saudiPeriodKeys,
  type ReportPeriod,
} from '@/lib/saudiTime'
import type { EntryExitLog } from '@/lib/types'
import type { TranslationKey } from '@/i18n/translations'

const sizes = [20, 50, 100, 200, 350, 500]

function toOption(row: Record<string, string>) {
  return { value: row.id, label: row.name_ar ?? row.full_name ?? row.code }
}

// Accepts Saudi date keys, plus full timestamps from older shared links.
function dateKeyParam(value: string | null): string | null {
  if (isDateKey(value)) return value
  if (value && !Number.isNaN(Date.parse(value))) return saudiDateKey(value)
  return null
}
/**
 * The movement columns this list shows.
 *
 * The equipment embed carries an `!inner` hint only while an owner filter is
 * active: `equipment.ownership_status` is filtered through that embed, and an
 * inner join is what makes the filter (and the `count`) apply to the movement
 * rows. With no owner selected the embed stays the plain left join it has
 * always been, so the unfiltered report is byte-for-byte the previous query.
 *
 * The recorder's name is not embedded: `profiles` is hidden from other users
 * by RLS, so it is read afterwards from the name-only `profile_names` view
 * (migration 0099) for the ids on the page.
 */
function buildSelect(ownerFiltered: boolean) {
  const equipment = `equipment:equipment${ownerFiltered ? '!inner' : ''}(id,code,type,plate_number,chassis_number)`
  return `id,equipment_id,supervisor_id,movement_type,movement_context,driver_id,driver_name,contractor_equipment_code,registration_method,odometer_reading,notes,photo_url,company_id,project_id,recorded_at,created_at,${equipment},company:companies(id,name_ar,name_en),project:projects(id,name_ar,name_en),driver:drivers(id,mobile_number)`
}

export function EntryReportsAll({
  onSelectMovement,
}: {
  onSelectMovement?: (id: string) => void
}) {
  const { t } = useI18n()
  const router = useRouter()
  const params = useSearchParams()
  const [rows, setRows] = useState<EntryExitLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  // True once a request has succeeded: from then on a refetch keeps the
  // previous result (rows or the empty state) on screen instead of a skeleton.
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const page = Math.max(1, Number(params.get('page')) || 1)
  const pageSize = sizes.includes(Number(params.get('page_size')))
    ? Number(params.get('page_size'))
    : 20
  const requestedPeriod = params.get('period')
  const defaultRange = saudiPeriodKeys(
    requestedPeriod === 'today' || requestedPeriod === 'week'
      ? (requestedPeriod as ReportPeriod)
      : 'month',
  )
  // Saudi calendar dates (YYYY-MM-DD); an empty value means no bound.
  const dateRange = {
    from: params.has('from')
      ? (dateKeyParam(params.get('from')) ?? '')
      : defaultRange.from,
    to: params.has('to')
      ? (dateKeyParam(params.get('to')) ?? '')
      : defaultRange.to,
  }
  // Owner + context filter, applied server-side and kept in the URL. The owner
  // list is derived from the raw parameter so it keeps one identity per URL and
  // the effect below does not re-run on every render.
  const ownersParam = params.get('owners') ?? ''
  const owners = useMemo(() => parseReportOwners(ownersParam), [ownersParam])
  const context = parseReportContext(params.get('context'))
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    // Cleared dates stay in the URL as empty values so they do not fall back
    // to the default period.
    if (value || key === 'from' || key === 'to') next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.set('page', '1')
    router.replace(`/reports/entries/all?${next.toString()}`, { scroll: false })
  }
  const setFilters = (filters: {
    owners?: AdminHomeOwner[]
    context?: ReportContext
  }) => {
    const next = applyReportFilterParams(
      new URLSearchParams(params.toString()),
      filters.owners ?? owners,
      filters.context ?? context,
    )
    next.set('page', '1')
    router.replace(`/reports/entries/all?${next.toString()}`, { scroll: false })
  }
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError(false)
    let query = supabase
      .from('entry_exit_logs')
      .select(buildSelect(owners.length > 0), { count: 'exact' })
      .eq('movement_type', 'entry')
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)
      .abortSignal(controller.signal)
    // `all` drops the context bound entirely; anything else keeps the single
    // context, and `site` is what this list always filtered on.
    if (context !== 'all') query = query.eq('movement_context', context)
    // The owner lives on the equipment record, so it is filtered through the
    // embed, which `buildSelect` made an inner join for exactly this case. No
    // owner selected means no filter at all.
    if (owners.length) query = query.in('equipment.ownership_status', owners)
    const from = dateRange.from
    const to = dateRange.to
    const q = params.get('q')
    if (from) query = query.gte('recorded_at', saudiDayStart(from))
    if (to) query = query.lte('recorded_at', saudiDayEnd(to))
    if (q) {
      const safe = sanitizeSearchTerm(q)
      if (safe)
        query = query.or(
          `driver_name.ilike.%${safe}%,contractor_equipment_code.ilike.%${safe}%`,
        )
    }
    for (const key of [
      'company_id',
      'project_id',
      'equipment_id',
      'driver_id',
      'supervisor_id',
    ]) {
      const value = params.get(key)
      if (value) query = query.eq(key, value)
    }
    const load = async () => {
      const { data, count, error } = await query
      // A newer request replaced this one; keep the current rows on screen.
      if (controller.signal.aborted) return
      const pageRows = (data ?? []) as unknown as Array<{
        supervisor_id: string | null
      }>
      const names = error
        ? null
        : await fetchProfileNames(
            supabase,
            pageRows.map((row) => row.supervisor_id),
            controller.signal,
          )
      if (controller.signal.aborted) return
      // A failed name lookup fails the list, exactly as the former embed did.
      if (error || !names || names.failed) {
        console.error('entry reports list load failed', error ?? 'names')
        setRows([])
        setTotal(0)
        setLoadError(true)
        setLoaded(false)
        setLoading(false)
        return
      }
      setLoaded(true)
      setRows(
        withSupervisorNames(pageRows, names.names) as unknown as EntryExitLog[],
      )
      setTotal(count ?? 0)
      setLoading(false)
    }
    void load()
    return () => controller.abort()
  }, [page, pageSize, params, dateRange.from, dateRange.to, owners, context])
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const firstLoad = loading && !loaded
  const refreshing = loading && loaded
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title={t('entryReports')}
        description={t('viewAll')}
        actions={
          <button
            className="btn-outline"
            onClick={() => router.push('/reports/entries')}
          >
            {t('back')}
          </button>
        }
      />
      <div className="card flex flex-wrap gap-2 p-3">
        <input
          // Remount when the URL search changes (Clear, Back) so the box
          // always shows the active search.
          key={params.get('q') ?? ''}
          className="input h-8 min-w-48"
          placeholder={t('search')}
          aria-label={t('search')}
          defaultValue={params.get('q') ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setParam('q', e.currentTarget.value)
          }}
        />
        <input
          type="date"
          className="input h-8"
          aria-label={t('fromDate')}
          value={dateRange.from}
          max={dateRange.to || undefined}
          onChange={(e) => setParam('from', e.target.value)}
        />
        <input
          type="date"
          className="input h-8"
          aria-label={t('toDate')}
          value={dateRange.to}
          min={dateRange.from || undefined}
          onChange={(e) => setParam('to', e.target.value)}
        />
        <select
          className="input h-8"
          value={pageSize}
          onChange={(e) => setParam('page_size', e.target.value)}
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        {(
          [
            'company_id',
            'project_id',
            'equipment_id',
            'driver_id',
            'supervisor_id',
          ] as const
        ).map((key) => (
          <ReportRelationFilter
            key={key}
            filterKey={key}
            value={params.get(key) ?? ''}
            onChange={(value) => setParam(key, value)}
          />
        ))}
        <OwnerContextFilter
          owners={owners}
          onOwnersChange={(next) => setFilters({ owners: next })}
          context={context}
          onContextChange={(next) => setFilters({ context: next })}
          showContext
        />
        <button
          className="btn-outline"
          onClick={() => router.replace('/reports/entries/all')}
        >
          {t('clear')}
        </button>
      </div>
      {firstLoad ? (
        <ReportListSkeleton />
      ) : loadError ? (
        <Alert type="error">{t('dataLoadError')}</Alert>
      ) : rows.length ? (
        <div
          aria-busy={refreshing || undefined}
          className={
            refreshing
              ? 'grid gap-3 opacity-60 transition-opacity lg:grid-cols-2'
              : 'grid gap-3 transition-opacity lg:grid-cols-2'
          }
        >
          {rows.map((row) => (
            <MovementLogCard
              key={row.id}
              log={row}
              onSelect={() => onSelectMovement?.(row.id)}
              showTodayBadge
            />
          ))}
        </div>
      ) : (
        <div
          aria-busy={refreshing || undefined}
          className={
            refreshing
              ? 'card p-8 text-center text-muted opacity-60 transition-opacity'
              : 'card p-8 text-center text-muted transition-opacity'
          }
        >
          {t('noReportData')}
        </div>
      )}
      <div className="flex items-center justify-center gap-4 text-sm">
        <button
          className="btn-outline"
          disabled={page <= 1}
          onClick={() => setParam('page', String(page - 1))}
        >
          {t('previous')}
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button
          className="btn-outline"
          disabled={page >= totalPages}
          onClick={() => setParam('page', String(page + 1))}
        >
          {t('next')}
        </button>
      </div>
    </div>
  )
}

function ReportRelationFilter({
  filterKey,
  value,
  onChange,
}: {
  filterKey: string
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const table =
    filterKey === 'company_id'
      ? 'companies'
      : filterKey === 'project_id'
        ? 'projects'
        : filterKey === 'equipment_id'
          ? 'equipment'
          : filterKey === 'driver_id'
            ? 'drivers'
            : 'profiles'
  const fields =
    table === 'companies' || table === 'projects'
      ? 'id,name_ar,name_en'
      : table === 'equipment'
        ? 'id,code,type'
        : 'id,full_name'
  // Show the selected record's name (not its id) after a reload or Back.
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!value) {
      setSelectedLabel(null)
      return
    }
    let active = true
    supabase
      .from(table)
      .select(fields)
      .eq('id', value)
      .maybeSingle()
      .then(({ data, error }) => {
        // A failed lookup must not leave the trigger on "loading" forever.
        if (active && error) setSelectedLabel('—')
        else if (active && data)
          setSelectedLabel(
            toOption(data as unknown as Record<string, string>).label,
          )
      })
    return () => {
      active = false
    }
  }, [value, table, fields])
  const loadOptions = async (raw: string) => {
    // Arabic names are matched normalized (migration 0116); foremen
    // (`profiles`) have no normalized column and keep the plain name.
    const searchFilter = buildSearchFilter(
      table === 'equipment'
        ? EQUIPMENT_CODE_TYPE_SEARCH_FIELDS
        : table === 'companies' || table === 'projects'
          ? COMPANY_PROJECT_SEARCH_FIELDS
          : table === 'drivers'
            ? DRIVER_SEARCH_FIELDS
            : ['full_name'],
      raw,
    )
    let query = supabase.from(table).select(fields).limit(20)
    if (searchFilter) query = query.or(searchFilter)
    return (unwrapRows(await query) as unknown as Record<string, string>[]).map(
      toOption,
    )
  }
  const labelKey =
    filterKey === 'driver_id' ? 'drivers' : filterKey.replace('_id', '')
  return (
    <AsyncSearchSelect
      value={value}
      selectedOption={
        value ? { value, label: selectedLabel ?? t('loading') } : null
      }
      onChange={(next) => onChange(next)}
      loadOptions={loadOptions}
      placeholder={t(labelKey as TranslationKey)}
      className="min-w-36"
    />
  )
}
