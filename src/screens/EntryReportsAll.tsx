import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { PageHeader } from '@/components/PageHeader'
import { MovementLogCard } from '@/components/MovementLogCard'
import { InlineSpinner } from '@/components/Spinner'
import type { EntryExitLog } from '@/lib/types'

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
    const from = params.get('from')
    const to = params.get('to')
    const q = params.get('q')
    if (from) query = query.gte('recorded_at', from)
    if (to) query = query.lte('recorded_at', to)
    if (q)
      query = query.or(
        `driver_name.ilike.%${q}%,contractor_equipment_code.ilike.%${q}%`,
      )
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
    query.then(({ data, count }) => {
      setRows((data ?? []) as unknown as EntryExitLog[])
      setTotal(count ?? 0)
      setLoading(false)
    })
    return () => controller.abort()
  }, [page, pageSize, params])
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
