import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { PageHeader } from '@/components/PageHeader'
import { InlineSpinner } from '@/components/Spinner'
import { MovementLogCard } from '@/components/MovementLogCard'
import { DatePicker } from '@/components/DatePicker'
import { sanitizeSearchTerm } from '@/lib/search'
import { isDateKey, saudiDayEnd, saudiDayStart } from '@/lib/saudiTime'
import type { EntryExitLog } from '@/lib/types'

const sizes = [20, 50, 100, 200, 350, 500]
const select =
  'id,equipment_id,supervisor_id,movement_type,movement_context,workshop_purpose,driver_id,driver_name,recorded_at,created_at,equipment:equipment(id,code,type,plate_number,chassis_number),supervisor:profiles(id,full_name),driver:drivers(id,mobile_number)'

export function WorkshopReports({
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
  const [loadError, setLoadError] = useState(false)
  const page = Math.max(1, Number(params.get('page')) || 1)
  const pageSize = sizes.includes(Number(params.get('page_size')))
    ? Number(params.get('page_size'))
    : 20
  const search = params.get('q') ?? ''

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.set('page', '1')
    router.replace(`/reports/workshop?${next.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoading(true)
      setLoadError(false)
      const term = sanitizeSearchTerm(search)
      let equipmentIds: string[] = []
      if (term) {
        const { data, error } = await supabase
          .from('equipment')
          .select('id')
          .or(
            `code.ilike.%${term}%,type.ilike.%${term}%,plate_number.ilike.%${term}%,chassis_number.ilike.%${term}%`,
          )
          .limit(100)
          .abortSignal(controller.signal)
        if (controller.signal.aborted) return
        if (error) {
          setLoadError(true)
          setLoading(false)
          return
        }
        equipmentIds = (data ?? []).map((item) => item.id)
      }
      let query = supabase
        .from('entry_exit_logs')
        .select(select, { count: 'exact' })
        .eq('movement_context', 'workshop')
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1)
        .abortSignal(controller.signal)
      const movementType = params.get('movement_type')
      const purpose = params.get('purpose')
      const from = params.get('from')
      const to = params.get('to')
      if (movementType === 'entry' || movementType === 'exit')
        query = query.eq('movement_type', movementType)
      if (purpose === 'maintenance' || purpose === 'parking')
        query = query.eq('workshop_purpose', purpose)
      if (isDateKey(from)) query = query.gte('recorded_at', saudiDayStart(from))
      if (isDateKey(to)) query = query.lte('recorded_at', saudiDayEnd(to))
      if (term) {
        if (!equipmentIds.length) {
          setRows([])
          setTotal(0)
          setLoading(false)
          return
        }
        query = query.in('equipment_id', equipmentIds)
      }
      const { data, count, error } = await query
      if (controller.signal.aborted) return
      if (error) {
        setLoadError(true)
        setRows([])
        setTotal(0)
      } else {
        setRows((data as unknown as EntryExitLog[]) ?? [])
        setTotal(count ?? 0)
      }
      setLoading(false)
    }
    void load()
    return () => controller.abort()
  }, [page, pageSize, search, params])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title={t('workshopReports')}
        description={t('workshopReportsDesc')}
      />
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <Search size={16} className="text-muted" />
        <input
          // Remount when the URL search changes (Clear, Back).
          key={search}
          className="input h-8 min-w-52 flex-1"
          aria-label={t('searchWorkshopMovements')}
          defaultValue={search}
          placeholder={t('searchWorkshopMovements')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setParam('q', event.currentTarget.value)
          }}
        />
        <select
          className="input h-8"
          value={params.get('movement_type') ?? ''}
          onChange={(event) => setParam('movement_type', event.target.value)}
        >
          <option value="">{t('allMovementTypes')}</option>
          <option value="entry">{t('entry')}</option>
          <option value="exit">{t('exit')}</option>
        </select>
        <select
          className="input h-8"
          value={params.get('purpose') ?? ''}
          onChange={(event) => setParam('purpose', event.target.value)}
        >
          <option value="">{t('allWorkshopPurposes')}</option>
          <option value="maintenance">{t('maintenancePurpose')}</option>
          <option value="parking">{t('parkingPurpose')}</option>
        </select>
        <DatePicker
          value={params.get('from') ?? ''}
          onChange={(value) => setParam('from', value)}
          placeholder={t('fromDate')}
          className="w-36"
        />
        <DatePicker
          value={params.get('to') ?? ''}
          onChange={(value) => setParam('to', value)}
          placeholder={t('toDate')}
          className="w-36"
        />
        <select
          className="input h-8"
          value={pageSize}
          onChange={(event) => setParam('page_size', event.target.value)}
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <button
          className="btn-outline"
          onClick={() => router.replace('/reports/workshop')}
        >
          {t('clear')}
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center p-10">
          <InlineSpinner />
        </div>
      ) : loadError ? (
        <div className="card p-8 text-center text-muted">
          {t('workshopReportLoadError')}
        </div>
      ) : rows.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((row) => (
            <MovementLogCard
              key={row.id}
              log={row}
              showWorkshopPurpose
              onSelect={
                onSelectMovement ? () => onSelectMovement(row.id) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <div className="card p-8 text-center text-muted">
          {t('noWorkshopMovements')}
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
