import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Clock3, MapPin, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { PageHeader } from '@/components/PageHeader'
import { InlineSpinner } from '@/components/Spinner'
import { Alert } from '@/components/Alert'
import { formatDateTime } from '@/lib/dateFormat'
import { formatElapsedDuration } from '@/lib/duration'

const sizes = [20, 50, 100, 200, 350, 500]

type AttentionReason = 'no_movement' | 'open_visit' | 'outside_sites'
type ReportRow = {
  equipment_id: string
  equipment_code: string
  equipment_type: string | null
  plate_number: string | null
  movement_id: string | null
  movement_type: 'entry' | 'exit' | null
  movement_context: 'site' | 'workshop' | null
  last_movement_at: string | null
  project_name_ar: string | null
  project_name_en: string | null
  attention_reason: AttentionReason
}
type ReportData = {
  total: number
  summary: Record<AttentionReason, number>
  rows: ReportRow[]
}

export function EquipmentReports() {
  const { t, lang } = useI18n()
  const router = useRouter()
  const params = useSearchParams()
  const [data, setData] = useState<ReportData | null>(null)
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
    router.replace(`/reports/equipment?${next.toString()}`, { scroll: false })
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    supabase
      .rpc('get_equipment_attention_report', {
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
        p_search: search || null,
      })
      .then(({ data: result, error }) => {
        if (cancelled) return
        if (error)
          console.error('equipment attention report load failed', error)
        setLoadError(!!error)
        setData(error ? null : ((result ?? null) as ReportData | null))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, pageSize, search])

  const number = (value: number | undefined) =>
    new Intl.NumberFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US').format(
      value ?? 0,
    )
  const stats: Array<[AttentionReason, string, string, string]> = [
    [
      'open_visit',
      t('equipmentReportOpenVisits'),
      t('equipmentReportOpenVisitsDesc'),
      'text-emerald-700 dark:text-emerald-400',
    ],
    [
      'outside_sites',
      t('equipmentReportOutsideSites'),
      t('equipmentReportOutsideSitesDesc'),
      'text-amber-700 dark:text-amber-400',
    ],
    [
      'no_movement',
      t('equipmentReportNoMovement'),
      t('equipmentReportNoMovementSummaryDesc'),
      'text-slate-700 dark:text-slate-300',
    ],
  ]
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        title={t('equipmentReports')}
        description={t('equipmentReportsDesc')}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map(([reason, label, description, color]) => (
          <div key={reason} className="card p-4">
            <p className="text-xs text-muted">{label}</p>
            <div className={`mt-2 text-2xl font-bold ${color}`}>
              {loading ? (
                <InlineSpinner />
              ) : data ? (
                number(data.summary?.[reason])
              ) : (
                '—'
              )}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              {description}
            </p>
          </div>
        ))}
      </div>
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <Search size={16} className="text-muted" />
        <input
          // Remount when the URL search changes (Back).
          key={search}
          className="input h-8 min-w-52 flex-1"
          aria-label={t('searchEquipmentReport')}
          defaultValue={search}
          placeholder={t('searchEquipmentReport')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setParam('q', event.currentTarget.value)
          }}
        />
        <select
          className="input h-8"
          value={pageSize}
          onChange={(event) => setParam('page_size', event.target.value)}
          aria-label={t('rowsPerPage')}
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
      ) : loadError ? (
        <Alert type="error">{t('dataLoadError')}</Alert>
      ) : data?.rows.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.rows.map((row) => (
            <EquipmentAttentionCard
              key={row.equipment_id}
              row={row}
              onOpen={() => router.push(`/equipment/${row.equipment_id}`)}
            />
          ))}
        </div>
      ) : (
        <div className="card p-8 text-center text-muted">
          {t('noEquipmentAttention')}
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

function EquipmentAttentionCard({
  row,
  onOpen,
}: {
  row: ReportRow
  onOpen: () => void
}) {
  const { t, lang } = useI18n()
  const config = {
    open_visit: {
      label: t('equipmentReportOpenVisit'),
      badge: 'status-entry',
      border: 'border-emerald-500 dark:border-emerald-500',
      durationLabel: t('currentVisitDuration'),
      icon: Clock3,
    },
    outside_sites: {
      label: t('equipmentReportOutside'),
      badge: 'status-exit',
      border: 'border-amber-500 dark:border-amber-500',
      durationLabel: t('sinceLastExit'),
      icon: MapPin,
    },
    no_movement: {
      label: t('equipmentReportNoMovement'),
      badge:
        'border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
      border: 'border-slate-300 dark:border-slate-600',
      durationLabel: t('elapsedDuration'),
      icon: AlertTriangle,
    },
  }[row.attention_reason]
  const Icon = config.icon
  const location =
    row.attention_reason === 'outside_sites'
      ? t('outsideSites')
      : row.movement_context === 'workshop'
        ? t('workshopLocation')
        : ((lang === 'ar' ? row.project_name_ar : row.project_name_en) ??
          t('unknownLocation'))
  return (
    <article className={`card border-s-4 p-4 ${config.border}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{row.equipment_code}</p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {row.equipment_type ?? '—'} · {row.plate_number ?? '—'}
          </p>
        </div>
        <span className={`badge shrink-0 ${config.badge}`}>
          <Icon size={13} />
          {config.label}
        </span>
      </div>
      {row.last_movement_at ? (
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted">{t('lastMovement')}</p>
            <p className="mt-1 font-medium">
              {formatDateTime(row.last_movement_at)}
            </p>
          </div>
          <div>
            <p className="text-muted">{t('location')}</p>
            <p className="mt-1 font-medium">{location}</p>
          </div>
          <div className="col-span-2">
            <p className="text-muted">{config.durationLabel}</p>
            <p className="mt-1 font-medium">
              {formatElapsedDuration(
                Date.now() - new Date(row.last_movement_at).getTime(),
                t,
                lang,
              )}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">
          {t('equipmentReportNoMovementDesc')}
        </p>
      )}
      <button className="btn-outline mt-4 w-full" onClick={onOpen}>
        <ArrowLeft size={15} />
        {t('viewDetails')}
      </button>
    </article>
  )
}
