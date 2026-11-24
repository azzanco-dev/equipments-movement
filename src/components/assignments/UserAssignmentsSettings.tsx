import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Users } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { usePermissions } from '@/auth/PermissionsContext'
import { AssignmentLines } from '@/components/assignments/AssignmentLines'
import { UserAssignmentsDialog } from '@/components/assignments/UserAssignmentsDialog'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useCompanyProjectFilters } from '@/components/data-list/relationFilters'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import { roleName } from '@/components/roles/roleRows'
import { useActiveRoles } from '@/components/roles/useActiveRoles'
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
  Tooltip,
  useToast,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { applyListFilters } from '@/lib/applyListFilters'
import {
  USER_ASSIGNMENT_COLUMN_FILTERS,
  USER_ASSIGNMENT_LIST_SELECT,
  assignmentsFromRows,
  assignmentsLockOf,
  filterIds,
  rowsFromAssignments,
  type UserAssignmentListRow,
} from '@/lib/foremanAssignments'
import { userAssignmentsListConfig } from '@/lib/listConfigs'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'

/**
 * Settings › «اسناد الشركات والمشاريع» (/settings/assignments, migration 0212,
 * owner 2026-11-24, «نبغى نخلي اسنادات الشركات والمشاريع للمستخدمين مهمة
 * منفصلة عن صفحة المستخدم», design approved in Figma): every user who is not
 * an admin over `user_assignment_list`, server-side searched by name,
 * filtered by role, company, «يسجل حركات مشاريع» (the foremen, a visible
 * removable default) and «عليه اسناد», sorted and paged through the unified
 * list system. Each user shows his companies, one line each with its
 * projects or «كل المشاريع»; the pencil opens `UserAssignmentsDialog`. The
 * page is open to users.manage and users.assignments; the caller's own
 * account is locked unless he is the admin (the database refuses it too).
 * Below md each user is a card.
 */
export function UserAssignmentsSettings() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const { user: currentUser } = useAuth()
  const { can } = usePermissions()
  const callerIsAdmin = can('settings.roles')
  const list = useDataListState(userAssignmentsListConfig)
  const [rows, setRows] = useState<UserAssignmentListRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [editing, setEditing] = useState<UserAssignmentListRow | null>(null)
  const { roles: activeRoles } = useActiveRoles(true)

  const companyFilter = useCompanyProjectFilters().company_id
  const asyncFields = useMemo(
    () => ({ company_ids: companyFilter }),
    [companyFilter],
  )
  // The role filter's options: the active roles but the admin (the view
  // never lists an admin).
  const filterFields = useMemo(
    () =>
      userAssignmentsListConfig.filterFields.map((field) =>
        field.key === 'role_key'
          ? {
              ...field,
              options: (activeRoles ?? [])
                .filter((role) => role.key !== 'admin')
                .map((role) => ({
                  value: role.key,
                  label: roleName(lang, role),
                })),
            }
          : field,
      ),
    [activeRoles, lang],
  )

  const startListRequest = useListRequest()
  const fetchRows = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(false)
    let query = supabase
      .from('user_assignment_list')
      .select(USER_ASSIGNMENT_LIST_SELECT, { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .order('id', { ascending: true })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      userAssignmentsListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    query = applyListFilters(
      query,
      list.filters,
      new Set(
        userAssignmentsListConfig.filterFields
          .map((field) => field.key)
          .filter((key) => !USER_ASSIGNMENT_COLUMN_FILTERS.has(key)),
      ),
    )
    // The company filter: any of the ticked companies (array overlap).
    const companies = list.filters
      .filter((filter) => filter.field === 'company_ids')
      .flatMap((filter) => filterIds(filter.value))
    if (companies.length) query = query.overlaps('company_ids', companies)
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) setLoadError(true)
    setRows((data as unknown as UserAssignmentListRow[] | null) ?? [])
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
  const lockOf = (row: UserAssignmentListRow) =>
    assignmentsLockOf({
      callerIsAdmin,
      callerId: currentUser?.id,
      targetId: row.id,
      // The view lists no admin; a row is never an admin's.
      targetIsAdmin: false,
    })
  const roleLabel = (row: UserAssignmentListRow) =>
    row.role_key
      ? roleName(lang, { name_ar: row.role_name_ar ?? row.role_key, name_en: row.role_name_en ?? row.role_key })
      : t('roleUsersNoRole')

  const editButton = (row: UserAssignmentListRow) => {
    const lock = lockOf(row)
    const button = (
      <IconButton
        size="sm"
        label={t('userAssignmentsEdit')}
        icon={<Pencil size={15} aria-hidden="true" />}
        disabled={Boolean(lock)}
        onClick={() => setEditing(row)}
      />
    )
    if (!lock) return button
    const reason: TranslationKey =
      lock === 'own' ? 'userAssignmentsOwnLocked' : 'userAssignmentsAdminLocked'
    return (
      <Tooltip content={t(reason)}>
        <span className="inline-flex">{button}</span>
      </Tooltip>
    )
  }

  const userCell = (row: UserAssignmentListRow) => (
    <span className="flex flex-col gap-0.5 text-start">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold">{row.full_name}</span>
        {row.id === currentUser?.id && (
          <Badge tone="info" size="sm">
            {t('userAssignmentsYou')}
          </Badge>
        )}
      </span>
      <span className="text-xs text-muted">{roleLabel(row)}</span>
    </span>
  )

  const columns: DataTableColumn<UserAssignmentListRow>[] = [
    {
      key: 'full_name',
      header: t('userAssignmentsUser'),
      sortable: true,
      width: '15rem',
      cell: userCell,
    },
    {
      key: 'assignments',
      header: t('userAssignmentsColumn'),
      cell: (row) => <AssignmentLines rows={row.assignments} compact />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('actions')}</span>,
      width: '4rem',
      align: 'end',
      cell: editButton,
    },
  ]

  return (
    <div className="space-y-4">
      <DataListToolbar
        config={userAssignmentsListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filterFields={filterFields}
        filters={list.filters}
        onFilters={list.setFilters}
        asyncFields={asyncFields}
      />
      {loadError ? (
        <ErrorState
          description={t('userAssignmentsLoadError')}
          onRetry={fetchRows}
        />
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={<Users size={28} aria-hidden="true" />}
          title={
            filtered
              ? t('userAssignmentsEmptyFiltered')
              : t('userAssignmentsEmpty')
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              size="md"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              loading={loading}
              loadingRows={6}
              caption={t('userAssignments')}
              sort={{ key: list.sort, direction: list.direction }}
              onSortChange={list.setSort}
              cellTextClassName="text-[13px]"
              cellClassName="py-2"
            />
          </div>
          {/* Below md: one card per user (the approved phone design). */}
          <div className="space-y-3 md:hidden">
            {loading && rows.length === 0
              ? Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-28 w-full rounded-xl" />
                ))
              : rows.map((row) => (
                  <div key={row.id} className="card space-y-2.5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      {userCell(row)}
                      {editButton(row)}
                    </div>
                    <div className="border-t pt-2.5">
                      <AssignmentLines rows={row.assignments} compact />
                    </div>
                  </div>
                ))}
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
      {editing && (
        <UserAssignmentsDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          userId={editing.id}
          userName={editing.full_name}
          subtitle={roleLabel(editing)}
          initial={assignmentsFromRows(editing.assignments, lang)}
          onSaved={(saved) => {
            const name = editing.full_name
            const savedRows = rowsFromAssignments(saved)
            setRows((current) =>
              current.map((row) =>
                row.id === editing.id
                  ? {
                      ...row,
                      assignments: savedRows,
                      company_ids: savedRows.map((item) => item.company_id),
                      has_assignments: savedRows.length > 0,
                    }
                  : row,
              ),
            )
            setEditing(null)
            toast({
              title: t('userAssignmentsSaved').replace('{name}', name),
              tone: 'success',
            })
          }}
        />
      )}
    </div>
  )
}
