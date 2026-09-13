import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BarChart3, CalendarDays, ExternalLink, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { PageHeader } from '@/components/PageHeader'
import { MovementLogCard } from '@/components/MovementLogCard'
import { formatDate } from '@/lib/dateFormat'
import type { EntryExitLog } from '@/lib/types'
import type { TranslationKey } from '@/i18n/translations'

type Range = { from: string; to: string }
type Ranked = { name: string; count: number; last_entry?: string | null }
type ReportData = {
  total: number
  equipment: number
  companies: number
  projects: number
  open: number
  latest: EntryExitLog[]
  open_visits: Array<{
    equipment_code: string
    equipment_type: string
    company_name: string | null
    project_name: string | null
    driver_name: string | null
    entry_recorded_at: string
  }>
  top_companies: Ranked[]
  top_projects: Ranked[]
  foremen: Ranked[]
}
function stayDuration(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  )
  return minutes < 60
    ? `${minutes} د`
    : `${Math.floor(minutes / 60)} س ${minutes % 60} د`
}

function rangeFor(value: string): Range {
  const now = new Date()
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  const start = new Date(now)
  if (value === 'today') start.setHours(0, 0, 0, 0)
  else if (value === 'week') {
    const day = start.getDay()
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
    start.setHours(0, 0, 0, 0)
  } else {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  }
  return { from: start.toISOString(), to: end.toISOString() }
}

export function EntryReports({
  onSelectMovement,
}: {
  onSelectMovement?: (id: string) => void
}) {
  const { t, lang } = useI18n()
  const router = useRouter()
  const params = useSearchParams()
  const preset = params.get('period') ?? 'month'
  const [period, setPeriod] = useState(preset)
  const [custom, setCustom] = useState<Range>({ from: '', to: '' })
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const range = useMemo(
    () => (period === 'custom' ? custom : rangeFor(period)),
    [period, custom],
  )

  useEffect(() => {
    if (!range.from || !range.to) return
    let cancelled = false
    setLoading(true)
    supabase
      .rpc('get_entry_report_summary', { p_from: range.from, p_to: range.to })
      .then(({ data: result, error }) => {
        if (!cancelled) {
          if (error) console.error('entry report load failed', error)
          setData((result ?? null) as ReportData)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [range])

  const setPreset = (value: string) => {
    setPeriod(value)
    router.replace(`/reports/entries?period=${value}`, { scroll: false })
  }
  const number = (value: number | undefined) =>
    new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-US').format(value ?? 0)
  const stats = [
    [t('totalEntries'), data?.total, 'text-fg'],
    [t('distinctEquipment'), data?.equipment, 'text-fg'],
    [t('activeCompanies'), data?.companies, 'text-fg'],
    [t('activeProjects'), data?.projects, 'text-fg'],
    [t('openEntries'), data?.open, 'text-emerald-700 dark:text-emerald-400'],
  ] as const

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        title={t('entryReports')}
        description={t('entryReportsDesc')}
      />
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <CalendarDays size={17} className="text-muted" />
        {(['today', 'week', 'month', 'custom'] as const).map((value) => (
          <button
            key={value}
            className={period === value ? 'btn-primary' : 'btn-outline'}
            onClick={() => setPreset(value)}
          >
            {value === 'today'
              ? t('todayBadge')
              : value === 'week'
                ? t('thisWeek')
                : value === 'month'
                  ? t('thisMonth')
                  : t('customPeriod')}
          </button>
        ))}
        {period === 'custom' && (
          <>
            <input
              type="date"
              className="input h-8"
              onChange={(e) =>
                setCustom((x) => ({
                  ...x,
                  from: new Date(`${e.target.value}T00:00:00`).toISOString(),
                }))
              }
            />
            <input
              type="date"
              className="input h-8"
              onChange={(e) =>
                setCustom((x) => ({
                  ...x,
                  to: new Date(`${e.target.value}T23:59:59`).toISOString(),
                }))
              }
            />
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map(([label, value, color]) => (
          <div key={label} className="card p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className={`mt-2 text-2xl font-bold ${color}`}>
              {loading ? (
                <Loader2 className="animate-spin" size={22} />
              ) : (
                number(value)
              )}
            </p>
            {label === t('openEntries') && (
              <p className="mt-1 text-[11px] text-muted">
                {t('currentIndicator')}
              </p>
            )}
          </div>
        ))}
      </div>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('latestEntries')}</h2>
          <button
            className="btn-outline"
            onClick={() => router.push(`/reports/entries/all?period=${period}`)}
          >
            <ExternalLink size={15} />
            {t('viewAll')}
          </button>
        </div>
        {data?.latest?.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.latest.map((log) => (
              <MovementLogCard
                key={log.id}
                log={log}
                onSelect={() => onSelectMovement?.(log.id)}
                showTodayBadge
              />
            ))}
          </div>
        ) : (
          <div className="card p-6 text-center text-sm text-muted">
            {t('noReportData')}
          </div>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <RankedSection
          title={t('topCompanies')}
          rows={data?.top_companies}
          number={number}
        />
        <RankedSection
          title={t('topProjects')}
          rows={data?.top_projects}
          number={number}
        />
        <RankedSection
          title={t('foremanActivity')}
          rows={data?.foremen}
          number={number}
          showLast
          t={t}
        />
      </div>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          {t('openVisits')}{' '}
          <span className="text-xs font-normal text-muted">
            ({t('currentIndicator')})
          </span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data?.open_visits?.map((visit) => (
            <div
              className="card space-y-2 p-4"
              key={`${visit.equipment_code}-${visit.entry_recorded_at}`}
            >
              <div className="flex justify-between">
                <span className="font-semibold">{visit.equipment_code}</span>
                <span className="badge status-entry">{t('entry')}</span>
              </div>
              <p className="text-xs text-muted">
                {visit.equipment_type} · {visit.company_name ?? '—'}
              </p>
              <p className="text-xs">
                {visit.project_name ?? '—'} · {visit.driver_name ?? '—'}
              </p>
              <p className="text-xs text-muted">
                {formatDate(visit.entry_recorded_at)} ·{' '}
                <span className="font-medium text-fg">
                  {stayDuration(visit.entry_recorded_at)}
                </span>
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function RankedSection({
  title,
  rows,
  number,
  showLast,
  t,
}: {
  title: string
  rows?: Ranked[]
  number: (n: number) => string
  showLast?: boolean
  t?: (key: TranslationKey) => string
}) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <BarChart3 size={16} />
        {title}
      </h2>
      <div className="space-y-2">
        {rows?.length ? (
          rows.map((row) => (
            <div
              key={row.name}
              className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">{row.name}</p>
                {showLast && row.last_entry && (
                  <p className="text-[11px] text-muted">
                    {t?.('lastEntry')}: {formatDate(row.last_entry)}
                  </p>
                )}
              </div>
              <span className="text-sm font-semibold">{number(row.count)}</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted">—</p>
        )}
      </div>
    </section>
  )
}
