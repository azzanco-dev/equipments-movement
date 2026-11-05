import { useCallback, useEffect, useMemo, useState } from 'react'
import { Edit2, Users } from 'lucide-react'
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  SearchInput,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { useListRequest } from '@/components/data-list/useListRequest'
import { useI18n } from '@/i18n/I18nContext'
import {
  PROFILE_ASSIGNMENTS_SELECT,
  assignmentsOf,
  groupAssignments,
  type CompanyAssignment,
  type ProfileAssignmentRow,
} from '@/lib/foremanAssignments'
import { foremanRoleKeys } from '@/lib/rolePermissionHolders'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import { ForemanAssignmentDialog } from './ForemanAssignmentDialog'

const PAGE_SIZE = 20

interface ForemanRow {
  id: string
  name: string
  assignments: CompanyAssignment[]
}

/**
 * Settings › «اسنادات الفورمينات» (0176, owner 2026-11-05): one row per
 * foreman — the users whose role records project movements, the admin
 * aside (`foremanRoleKeys`) — with his companies and, under each, his
 * projects or «كل المشاريع»; «تعديل» opens one dialog for both. Server-side
 * search by name and paging over `profile_names`; the page's assignments in
 * one bounded read of `profile_assignments`. Gated on `users.manage` (the
 * page gate and the function).
 */
export function ForemanAssignmentsSettings() {
  const { t, lang } = useI18n()
  const [rows, setRows] = useState<ForemanRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ForemanRow | null>(null)
  const startRequest = useListRequest()

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const fetchRows = useCallback(async () => {
    const signal = startRequest()
    setLoading(true)
    setLoadError(null)
    try {
      const roleKeys = await foremanRoleKeys(supabase)
      if (signal.aborted) return
      if (!roleKeys.length) {
        setRows([])
        setTotal(0)
        return
      }
      let query = supabase
        .from('profile_names')
        .select('id,full_name', { count: 'exact' })
        .in('role', roleKeys)
        .order('full_name')
        .order('id')
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      const term = sanitizeSearchTerm(search)
      if (term) query = query.ilike('full_name', `%${term}%`)
      const people = await query.abortSignal(signal)
      if (signal.aborted) return
      if (people.error) throw people.error
      const list = (people.data ?? []) as {
        id: string
        full_name: string | null
      }[]
      const assigned = list.length
        ? await supabase
            .from('profile_assignments')
            .select(PROFILE_ASSIGNMENTS_SELECT)
            .in(
              'profile_id',
              list.map((person) => person.id),
            )
            .abortSignal(signal)
        : { data: [], error: null }
      if (signal.aborted) return
      if (assigned.error) throw assigned.error
      const groups = groupAssignments(
        (assigned.data ?? []) as ProfileAssignmentRow[],
      )
      setRows(
        list.map((person) => ({
          id: person.id,
          name: person.full_name ?? '—',
          assignments: assignmentsOf(groups.get(person.id) ?? [], lang),
        })),
      )
      setTotal(people.count ?? 0)
    } catch {
      if (signal.aborted) return
      setLoadError(t('foremanAssignmentsLoadError'))
      setRows([])
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [lang, page, search, startRequest, t])

  useEffect(() => {
    void fetchRows()
  }, [fetchRows])

  const columns = useMemo<DataTableColumn<ForemanRow>[]>(
    () => [
      {
        key: 'name',
        header: t('foremanAssignmentsForeman'),
        className: 'font-semibold',
        cell: (row) => row.name,
      },
      {
        key: 'assignments',
        header: t('foremanAssignmentsColumn'),
        cell: (row) =>
          row.assignments.length ? (
            <ul className="space-y-1">
              {row.assignments.map((item) => (
                <li key={item.company.value} className="leading-6">
                  <span className="font-medium">{item.company.label}</span>
                  <span className="text-muted">
                    {' · '}
                    {item.projects.length
                      ? item.projects.map((project) => project.label).join('، ')
                      : t('foremanAssignmentsAllProjects')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <Badge size="sm">{t('foremanAssignmentsNone')}</Badge>
              <span className="text-xs text-muted">
                {t('foremanAssignmentsNoneHint')}
              </span>
            </span>
          ),
      },
      {
        key: 'actions',
        header: t('actions'),
        cell: (row) => (
          <IconButton
            size="sm"
            label={t('edit')}
            title={t('edit')}
            icon={<Edit2 size={15} />}
            onClick={() => setEditing(row)}
          />
        ),
      },
    ],
    [t],
  )

  return (
    <div className="space-y-3">
      <SearchInput
        value={searchInput}
        onValueChange={setSearchInput}
        placeholder={t('foremanAssignmentsSearch')}
        className="max-w-md"
      />
      {loadError ? (
        <ErrorState description={loadError} onRetry={fetchRows} />
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={<Users size={28} aria-hidden="true" />}
          title={t('foremanAssignmentsEmpty')}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={6}
          size="md"
          caption={t('foremanAssignmentsTitle')}
          cellTextClassName="text-[13px]"
          cellClassName="py-2"
          empty={t('foremanAssignmentsEmpty')}
        />
      )}
      {!loadError && total > 0 && (
        <DataListPagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPage={setPage}
        />
      )}
      <ForemanAssignmentDialog
        foreman={editing}
        initial={editing?.assignments ?? []}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        onSaved={fetchRows}
      />
    </div>
  )
}
