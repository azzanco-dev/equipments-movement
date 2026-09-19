import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Eye } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { formatDateTime } from '@/lib/dateFormat'
import { sanitizeSearchTerm } from '@/lib/search'
import {
  Badge,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  MovementBadge,
  PageHeader,
  SearchInput,
  Select,
} from '@/components/ui'
import type { BadgeTone, DataTableColumn } from '@/components/ui'

type AuditAction = 'create' | 'update' | 'delete'

interface MovementAuditRow {
  id: number
  movement_id: string
  action: AuditAction
  actor_name: string | null
  equipment_code: string | null
  movement_type: 'entry' | 'exit' | null
  movement_context: 'site' | 'workshop' | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  changed_fields: string[]
  created_at: string
}

const PAGE_SIZE = 20

const actionLabelKey: Record<
  AuditAction,
  'activityCreated' | 'activityUpdated' | 'activityDeleted'
> = {
  create: 'activityCreated',
  update: 'activityUpdated',
  delete: 'activityDeleted',
}

const actionTone: Record<AuditAction, BadgeTone> = {
  create: 'success',
  update: 'info',
  delete: 'danger',
}

export function MovementActivity() {
  const { t } = useI18n()
  const pathname = usePathname()
  const params = useSearchParams()
  const requestedPage = Number(params.get('page'))
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const search = params.get('q') ?? ''
  const action = ['create', 'update', 'delete'].includes(
    params.get('action') ?? '',
  )
    ? params.get('action')!
    : ''
  const context = ['site', 'workshop'].includes(params.get('context') ?? '')
    ? params.get('context')!
    : ''
  const [rows, setRows] = useState<MovementAuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [selected, setSelected] = useState<MovementAuditRow | null>(null)

  const replaceParams = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(params.toString())
      Object.entries(changes).forEach(([key, value]) => {
        if (value) next.set(key, value)
        else next.delete(key)
      })
      window.history.replaceState(null, '', `${pathname}?${next.toString()}`)
    },
    [params, pathname],
  )

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      const load = async () => {
        setLoading(true)
        setLoadError(false)
        let query = supabase
          .from('movement_audit_logs')
          .select(
            'id,movement_id,action,actor_name,equipment_code,movement_type,movement_context,old_values,new_values,changed_fields,created_at',
            { count: 'exact' },
          )
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
        const term = sanitizeSearchTerm(search)
        if (term)
          query = query.or(
            `equipment_code.ilike.%${term}%,actor_name.ilike.%${term}%`,
          )
        if (action) query = query.eq('action', action)
        if (context) query = query.eq('movement_context', context)
        const { data, count, error } = await query.abortSignal(
          controller.signal,
        )
        if (controller.signal.aborted) return
        if (error) {
          console.error('Movement activity load failed', error)
          setRows([])
          setTotal(0)
          setLoadError(true)
          setLoading(false)
          return
        }
        setRows((data as MovementAuditRow[] | null) ?? [])
        setTotal(count ?? 0)
        setLoading(false)
      }
      void load()
    }, 250)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [action, context, page, search, reloadToken])

  const fieldLabels = useMemo<Record<string, string>>(
    () => ({
      equipment_id: t('equipment'),
      supervisor_id: t('supervisor'),
      movement_type: t('movementType'),
      movement_context: t('location'),
      driver_id: t('driverName'),
      driver_name: t('driverName'),
      company_id: t('company'),
      project_id: t('project'),
      contractor_equipment_code: t('contractorEquipmentCode'),
      notes: t('notes'),
      recorded_at: t('actualMovementTime'),
      workshop_purpose: t('workshopPurpose'),
    }),
    [t],
  )

  const value = (item: unknown) => {
    if (item === null || item === undefined || item === '') return '—'
    if (typeof item === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(item))
      return formatDateTime(item)
    return String(item)
  }

  const columns: DataTableColumn<MovementAuditRow>[] = [
    {
      key: 'action',
      header: t('action'),
      cell: (row) => (
        <Badge size="sm" tone={actionTone[row.action]}>
          {t(actionLabelKey[row.action])}
        </Badge>
      ),
    },
    {
      key: 'equipment_code',
      header: t('equipment'),
      className: 'font-medium',
      cell: (row) => row.equipment_code ?? '—',
    },
    {
      key: 'movement_type',
      header: t('movementType'),
      cell: (row) =>
        row.movement_type ? <MovementBadge type={row.movement_type} /> : '—',
    },
    {
      key: 'actor_name',
      header: t('user'),
      cell: (row) => row.actor_name ?? t('system'),
    },
    {
      key: 'created_at',
      header: t('dateAndTime'),
      className: 'text-muted',
      cell: (row) => formatDateTime(row.created_at),
    },
    {
      key: 'view',
      header: '',
      width: '3rem',
      align: 'end',
      cell: (row) => (
        <IconButton
          label={t('viewDetails')}
          size="sm"
          variant="ghost"
          icon={<Eye size={16} />}
          onClick={() => setSelected(row)}
        />
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title={t('activityLog')} description={t('activityLogDesc')} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput
          className="sm:flex-1"
          value={search}
          onValueChange={(next) => replaceParams({ q: next, page: '' })}
          placeholder={t('searchActivity')}
        />
        <Select
          className="sm:w-40"
          value={action || 'all'}
          onValueChange={(next) =>
            replaceParams({ action: next === 'all' ? '' : next, page: '' })
          }
          options={[
            { value: 'all', label: t('allActions') },
            { value: 'create', label: t('activityCreated') },
            { value: 'update', label: t('activityUpdated') },
            { value: 'delete', label: t('activityDeleted') },
          ]}
        />
        <Select
          className="sm:w-40"
          value={context || 'all'}
          onValueChange={(next) =>
            replaceParams({ context: next === 'all' ? '' : next, page: '' })
          }
          options={[
            { value: 'all', label: t('allLocations') },
            { value: 'site', label: t('location') },
            { value: 'workshop', label: t('workshopLocation') },
          ]}
        />
      </div>

      {loadError ? (
        <ErrorState onRetry={() => setReloadToken((value) => value + 1)} />
      ) : !loading && rows.length === 0 ? (
        <EmptyState title={t('noActivity')} />
      ) : (
        <DataTable
          size="sm"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={6}
        />
      )}

      <DataListPagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPage={(nextPage) =>
          replaceParams({ page: nextPage === 1 ? '' : String(nextPage) })
        }
      />

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(next) => {
          if (!next) setSelected(null)
        }}
        title={t('activityDetails')}
        size="lg"
      >
        {selected && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted">{t('equipment')}</p>
                <p className="font-medium">{selected.equipment_code ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted">{t('user')}</p>
                <p className="font-medium">
                  {selected.actor_name ?? t('system')}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">{t('action')}</p>
                <p className="font-medium">
                  {t(actionLabelKey[selected.action])}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">{t('dateAndTime')}</p>
                <p className="font-medium">
                  {formatDateTime(selected.created_at)}
                </p>
              </div>
            </div>
            <div
              className="overflow-hidden rounded-lg border"
              style={{ borderColor: 'var(--border)' }}
            >
              {selected.changed_fields.map((field) => (
                <div
                  key={field}
                  className="grid grid-cols-[1fr_1.2fr_1.2fr] gap-2 border-b p-3 text-sm last:border-0"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span className="font-medium">
                    {fieldLabels[field] ?? field}
                  </span>
                  <span className="break-words text-muted">
                    {value(selected.old_values?.[field])}
                  </span>
                  <span className="break-words">
                    {value(selected.new_values?.[field])}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
