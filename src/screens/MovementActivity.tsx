import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Eye, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { PageHeader } from '@/components/PageHeader'
import { InlineSpinner } from '@/components/Spinner'
import { Modal } from '@/components/Modal'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { formatDateTime } from '@/lib/dateFormat'
import { sanitizeSearchTerm } from '@/lib/search'

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

export function MovementActivity() {
  const { t } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const search = params.get('q') ?? ''
  const action = params.get('action') ?? ''
  const context = params.get('context') ?? ''
  const [rows, setRows] = useState<MovementAuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<MovementAuditRow | null>(null)

  const replaceParams = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(params.toString())
      Object.entries(changes).forEach(([key, value]) => {
        if (value) next.set(key, value)
        else next.delete(key)
      })
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const load = async () => {
        setLoading(true)
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
        const { data, count, error } = await query
        if (error) console.error('Movement activity load failed', error)
        setRows((data as MovementAuditRow[] | null) ?? [])
        setTotal(count ?? 0)
        setLoading(false)
      }
      void load()
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [action, context, page, search])

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

  return (
    <div className="space-y-5">
      <PageHeader title={t('activityLog')} description={t('activityLogDesc')} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="input flex flex-1 items-center gap-2">
          <Search size={16} className="text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent outline-none"
            value={search}
            onChange={(event) =>
              replaceParams({ q: event.target.value, page: '' })
            }
            placeholder={t('searchActivity')}
          />
        </label>
        <select
          className="input sm:w-40"
          value={action}
          onChange={(event) =>
            replaceParams({ action: event.target.value, page: '' })
          }
        >
          <option value="">{t('allActions')}</option>
          <option value="create">{t('activityCreated')}</option>
          <option value="update">{t('activityUpdated')}</option>
          <option value="delete">{t('activityDeleted')}</option>
        </select>
        <select
          className="input sm:w-40"
          value={context}
          onChange={(event) =>
            replaceParams({ context: event.target.value, page: '' })
          }
        >
          <option value="">{t('allLocations')}</option>
          <option value="site">{t('location')}</option>
          <option value="workshop">{t('workshopLocation')}</option>
        </select>
      </div>

      {loading ? (
        <InlineSpinner label={t('loading')} />
      ) : rows.length === 0 ? (
        <div className="card py-12 text-center text-sm text-muted">
          {t('noActivity')}
        </div>
      ) : (
        <div
          className="overflow-x-auto rounded-xl border"
          style={{ borderColor: 'var(--border)' }}
        >
          <table className="w-full text-[13px]">
            <thead style={{ background: 'var(--surface)' }}>
              <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                <th className="px-3 py-2 text-start">{t('action')}</th>
                <th className="px-3 py-2 text-start">{t('equipment')}</th>
                <th className="px-3 py-2 text-start">{t('movementType')}</th>
                <th className="px-3 py-2 text-start">{t('user')}</th>
                <th className="px-3 py-2 text-start">{t('dateAndTime')}</th>
                <th className="w-12 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b last:border-0"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <td className="px-3 py-2">
                    <span
                      className={`badge ${row.action === 'delete' ? 'badge-exit' : row.action === 'create' ? 'badge-entry' : ''}`}
                    >
                      {t(
                        row.action === 'create'
                          ? 'activityCreated'
                          : row.action === 'update'
                            ? 'activityUpdated'
                            : 'activityDeleted',
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {row.equipment_code ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {row.movement_type
                      ? t(row.movement_type === 'entry' ? 'entry' : 'exit')
                      : '—'}
                  </td>
                  <td className="px-3 py-2">{row.actor_name ?? t('system')}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {formatDateTime(row.created_at)}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      className="btn-ghost h-8 w-8 p-0"
                      onClick={() => setSelected(row)}
                      aria-label={t('viewDetails')}
                    >
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DataListPagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPage={(nextPage) =>
          replaceParams({ page: nextPage === 1 ? '' : String(nextPage) })
        }
      />

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
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
                  {t(
                    selected.action === 'create'
                      ? 'activityCreated'
                      : selected.action === 'update'
                        ? 'activityUpdated'
                        : 'activityDeleted',
                  )}
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
      </Modal>
    </div>
  )
}
