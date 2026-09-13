import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { PageHeader } from '@/components/PageHeader'
import { MovementLogCard } from '@/components/MovementLogCard'
import { InlineSpinner } from '@/components/Spinner'
import { sanitizeSearchTerm } from '@/lib/search'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { EntryExitLog } from '@/lib/types'
import type { TranslationKey } from '@/i18n/translations'

const sizes = [20, 50, 100, 200, 350, 500]
const select =
  'id,equipment_id,supervisor_id,movement_type,movement_context,driver_id,driver_name,contractor_equipment_code,registration_method,odometer_reading,notes,photo_url,company_id,project_id,recorded_at,created_at,equipment:equipment(id,code,type,plate_number),company:companies(id,name_ar,name_en),project:projects(id,name_ar,name_en),supervisor:profiles(id,full_name),driver:drivers(id,mobile_number)'

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
  const page = Math.max(1, Number(params.get('page')) || 1)
  const pageSize = sizes.includes(Number(params.get('page_size')))
    ? Number(params.get('page_size'))
    : 20
  const period = params.get('period') ?? 'month'
  const dateRange = (() => {
    const now = new Date()
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    const start = new Date(now)
    if (period === 'today') start.setHours(0, 0, 0, 0)
    else if (period === 'week') {
      const day = start.getDay()
      start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
      start.setHours(0, 0, 0, 0)
    } else {
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
    }
    return {
      from: params.get('from') ?? start.toISOString(),
      to: params.get('to') ?? end.toISOString(),
    }
  })()
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.set('page', '1')
    router.replace(`/reports/entries/all?${next.toString()}`, { scroll: false })
  }
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    let query = supabase
      .from('entry_exit_logs')
      .select(select, { count: 'exact' })
      .eq('movement_context', 'site')
      .eq('movement_type', 'entry')
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)
      .abortSignal(controller.signal)
    const from = dateRange.from
    const to = dateRange.to
    const q = params.get('q')
    if (from) query = query.gte('recorded_at', from)
    if (to) query = query.lte('recorded_at', to)
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
    query.then(({ data, count, error }) => {
      if (error) {
        console.error('entry reports list load failed', error)
        setRows([])
        setTotal(0)
        setLoading(false)
        return
      }
      setRows((data ?? []) as unknown as EntryExitLog[])
      setTotal(count ?? 0)
      setLoading(false)
    })
    return () => controller.abort()
  }, [page, pageSize, params, dateRange.from, dateRange.to])
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
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
          className="input h-8 min-w-48"
          placeholder={t('search')}
          defaultValue={params.get('q') ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setParam('q', e.currentTarget.value)
          }}
        />
        <input
          type="date"
          className="input h-8"
          value={dateRange.from.slice(0, 10)}
          onChange={(e) =>
            setParam(
              'from',
              e.target.value
                ? new Date(`${e.target.value}T00:00:00`).toISOString()
                : '',
            )
          }
        />
        <input
          type="date"
          className="input h-8"
          value={dateRange.to.slice(0, 10)}
          onChange={(e) =>
            setParam(
              'to',
              e.target.value
                ? new Date(`${e.target.value}T23:59:59`).toISOString()
                : '',
            )
          }
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
        <button
          className="btn-outline"
          onClick={() => router.replace('/reports/entries/all')}
        >
          {t('clear')}
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center p-10">
          <InlineSpinner />
        </div>
      ) : rows.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
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
        <div className="card p-8 text-center text-muted">
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
  const loadOptions = async (raw: string) => {
    const safe = sanitizeSearchTerm(raw)
    const fields =
      table === 'companies' || table === 'projects'
        ? 'id,name_ar,name_en'
        : table === 'equipment'
          ? 'id,code,type'
          : 'id,full_name'
    let query = supabase.from(table).select(fields).limit(20)
    if (safe)
      query =
        table === 'equipment'
          ? query.or(`code.ilike.%${safe}%,type.ilike.%${safe}%`)
          : query.ilike(
              table === 'companies' || table === 'projects'
                ? 'name_ar'
                : 'full_name',
              `%${safe}%`,
            )
    const { data } = await query
    return ((data as unknown as Record<string, string>[] | null) ?? []).map(
      (row) => ({
        value: row.id,
        label: row.name_ar ?? row.full_name ?? row.code,
      }),
    )
  }
  const labelKey =
    filterKey === 'driver_id' ? 'drivers' : filterKey.replace('_id', '')
  return (
    <AsyncSearchSelect
      value={value}
      selectedOption={value ? { value, label: value } : null}
      onChange={(next) => onChange(next)}
      loadOptions={loadOptions}
      placeholder={t(labelKey as TranslationKey)}
      className="min-w-36"
    />
  )
}
