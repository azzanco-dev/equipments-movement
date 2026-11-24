import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Pencil, Users, X } from 'lucide-react'
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
  Button,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
  useToast,
  type DataTableColumn,
} from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { applyListFilters } from '@/lib/applyListFilters'
import {
  ASSIGNMENT_ROLE_KEYS,
  USER_ASSIGNMENT_COLUMN_FILTERS,
  USER_ASSIGNMENT_LIST_SELECT,
  assignmentCounts,
  assignmentsFromRows,
  assignmentsLockOf,
  companyCountWords,
  filterIds,
  firstCompanyNames,
  pickedProjectWords,
  rowsFromAssignments,
  type UserAssignmentListRow,
} from '@/lib/foremanAssignments'
import { userAssignmentsListConfig } from '@/lib/listConfigs'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'

/** The width from which the details sit beside the table (`xl`); below it
 *  they open in a dialog. From `xl` the table keeps room for its four
 *  columns beside the 380 px panel without a side scroll (owner 2026-11-24,
 *  «خلي الجدول اليمين له حد, بدون سكرول»). */
const SIDE_PANEL_QUERY = '(min-width: 1280px)'

function useSidePanelFits(): boolean {
  const [fits, setFits] = useState(false)
  useEffect(() => {
    const query = window.matchMedia(SIDE_PANEL_QUERY)
    const update = () => setFits(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return fits
}

/**
 * Settings › «اسناد الشركات والمشاريع» (/settings/assignments, migration 0212,
 * owner 2026-11-24, «نبغى نخلي اسنادات الشركات والمشاريع للمستخدمين مهمة
 * منفصلة عن صفحة المستخدم»; «ضمن الفورمينس فقط»; the layout is «نموذج 2»
 * of the Figma models, chosen the same day because a foreman with many
 * companies took too much room): the users of the roles «فورمين» and «رئيس
 * الفورمين» only (`ASSIGNMENT_ROLE_KEYS`) over
 * `user_assignment_list`, server-side searched by name, filtered by role,
 * company and «عليه اسناد», sorted and paged through the unified list system.
 * The table shows counts only — «9 شركات» with the first two names under it,
 * «4 محددة» or «كل المشاريع» — so every row keeps one height; a row opens
 * the details: from `xl` a panel beside the table, below it a dialog. The
 * details list every company with its projects and carry «تعديل الاسناد»
 * (`UserAssignmentsDialog`). The page is open to users.manage and
 * users.assignments; the caller's own account is locked unless he is the
 * admin (the database refuses it too). Below md each foreman is a card.
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<UserAssignmentListRow | null>(null)
  const panelFits = useSidePanelFits()
  const { roles: activeRoles } = useActiveRoles(true)

  const companyFilter = useCompanyProjectFilters().company_id
  const asyncFields = useMemo(
    () => ({ company_ids: companyFilter }),
    [companyFilter],
  )
  // The role filter's options: the two roles the page lists.
  const filterFields = useMemo(
    () =>
      userAssignmentsListConfig.filterFields.map((field) =>
        field.key === 'role_key'
          ? {
              ...field,
              options: (activeRoles ?? [])
                .filter((role) => ASSIGNMENT_ROLE_KEYS.includes(role.key))
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
      // The foremen and the foremen's lead only (owner 2026-11-24, «خليه
      // مقتصر على الفورمينس ورئيس الفورمين»: a sales user whose role also
      // records project movements was listed). Not a filter.
      .in('role_key', [...ASSIGNMENT_ROLE_KEYS])
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

  // The details follow the rows on screen: a foreman who left the page (a
  // search, a filter, another page) closes them.
  const selected = rows.find((row) => row.id === selectedId) ?? null
  const toggle = (row: UserAssignmentListRow) =>
    setSelectedId((current) => (current === row.id ? null : row.id))

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
      ? roleName(lang, {
          name_ar: row.role_name_ar ?? row.role_key,
          name_en: row.role_name_en ?? row.role_key,
        })
      : t('roleUsersNoRole')
  /** «9 شركات · 4 مشاريع محددة», «شركتين · كل المشاريع», «بدون اسناد». */
  const countsLine = (row: UserAssignmentListRow) => {
    const counts = assignmentCounts(row.assignments)
    if (!counts.companies) return t('userAssignmentsNone')
    return `${companyCountWords(counts.companies, lang)} · ${
      counts.projects
        ? pickedProjectWords(counts.projects, lang)
        : t('userAssignmentsAllProjects')
    }`
  }

  const userCell = (row: UserAssignmentListRow) => (
    <span className="flex min-w-0 flex-col gap-0.5 text-start">
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="break-words font-semibold">{row.full_name}</span>
        {row.id === currentUser?.id && (
          <Badge tone="info" size="sm">
            {t('userAssignmentsYou')}
          </Badge>
        )}
      </span>
      <span className="text-xs text-muted">{roleLabel(row)}</span>
    </span>
  )
  const companiesCell = (row: UserAssignmentListRow) => {
    const counts = assignmentCounts(row.assignments)
    if (!counts.companies)
      return <span className="text-muted">{t('userAssignmentsNone')}</span>
    return (
      <span className="flex min-w-0 flex-col gap-0.5 text-start">
        <span className="font-medium">
          {companyCountWords(counts.companies, lang)}
        </span>
        <span className="line-clamp-2 break-words text-xs text-muted">
          {firstCompanyNames(row.assignments, lang)}
        </span>
      </span>
    )
  }
  const projectsCell = (row: UserAssignmentListRow) => {
    const counts = assignmentCounts(row.assignments)
    if (!counts.companies) return <span className="text-muted">—</span>
    if (!counts.projects)
      return (
        <span className="text-muted">{t('userAssignmentsAllProjects')}</span>
      )
    return (
      <span className="tabular-nums">
        {t('userAssignmentsProjectsPicked').replace(
          '{count}',
          String(counts.projects),
        )}
      </span>
    )
  }

  const columns: DataTableColumn<UserAssignmentListRow>[] = [
    {
      key: 'full_name',
      header: t('userAssignmentsUser'),
      sortable: true,
      width: '12rem',
      // The full name and role, on a second line when long (owner
      // 2026-11-24, «فيه مشكلة في الاسماء, ماكول منها»: they were cut with «…»).
      className: 'min-w-[10rem] whitespace-normal',
      cell: userCell,
    },
    {
      key: 'companies',
      header: t('companies'),
      // Takes the room left, its names on up to two lines, never wider: the
      // table never scrolls sideways (owner 2026-11-24, «بدون سكرول»), and the
      // names are not cut (owner the same day, «ماكول منها»).
      className: 'w-full max-w-0 whitespace-normal',
      cell: companiesCell,
    },
    {
      key: 'projects',
      header: t('projects'),
      width: '8rem',
      cell: projectsCell,
    },
    {
      key: 'open',
      header: <span className="sr-only">{t('userAssignmentsOpenDetails')}</span>,
      width: '3rem',
      align: 'end',
      cell: () => (
        <ChevronRight
          size={16}
          aria-hidden="true"
          className="text-muted rtl-flip"
        />
      ),
    },
  ]

  /** The details: the counts, «تعديل الاسناد» (or why it is locked) and
   *  every company with its projects. */
  const details = (row: UserAssignmentListRow, stagger = false) => {
    const lock = lockOf(row)
    const reason: TranslationKey | null =
      lock === 'own'
        ? 'userAssignmentsOwnLocked'
        : lock === 'admin'
          ? 'userAssignmentsAdminLocked'
          : null
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-muted">{countsLine(row)}</p>
        <Button
          variant="primary"
          className="w-full"
          icon={<Pencil size={15} aria-hidden="true" />}
          disabled={Boolean(lock)}
          onClick={() => setEditing(row)}
        >
          {t('userAssignmentsEdit')}
        </Button>
        {reason && <p className="text-xs text-muted">{t(reason)}</p>}
        <div className="border-t pt-3">
          <AssignmentLines
            rows={row.assignments}
            compact
            divided
            stagger={stagger}
          />
        </div>
      </div>
    )
  }

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
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
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
                onRowClick={toggle}
                rowClassName={(row) =>
                  row.id === selectedId
                    ? 'bg-surface-hover transition-colors'
                    : 'transition-colors'
                }
                cellTextClassName="text-[13px]"
                cellClassName="py-2"
              />
            </div>
            {/* Below md: one card per foreman, the counts only. */}
            <div className="space-y-2 md:hidden">
              {loading && rows.length === 0
                ? Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-16 w-full rounded-xl" />
                  ))
                : rows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => toggle(row)}
                      className="card flex w-full items-center justify-between gap-3 p-3 text-start"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        {userCell(row)}
                        <span className="truncate text-xs text-muted">
                          {countsLine(row)}
                        </span>
                      </span>
                      <ChevronRight
                        size={16}
                        aria-hidden="true"
                        className="shrink-0 text-muted rtl-flip"
                      />
                    </button>
                  ))}
            </div>
          </div>
          {/* From xl the panel always stands beside the table (owner
              2026-11-24, «خلي القائمة الجانبية ثابتة حتى لو مو مختار احد»):
              «اختر فورمن» while none is picked; its content is keyed by the
              foreman, so it fades up again on every pick. */}
          {panelFits && (
            <aside
              aria-label={t('userAssignmentsDetails')}
              aria-live="polite"
              className="card sticky top-4 w-[380px] shrink-0 p-4"
            >
              {selected ? (
                <div key={selected.id} className="assign-panel-in space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold">
                        {selected.full_name}
                      </h2>
                      <p className="text-xs text-muted">
                        {roleLabel(selected)}
                      </p>
                    </div>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={t('close')}
                      icon={<X size={16} aria-hidden="true" />}
                      onClick={() => setSelectedId(null)}
                    />
                  </div>
                  {details(selected, true)}
                </div>
              ) : (
                <div className="assign-panel-in flex flex-col items-center gap-2 py-10 text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-hover text-muted">
                    <Users size={18} aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold">
                    {t('userAssignmentsPickTitle')}
                  </p>
                  <p className="max-w-60 text-xs text-muted">
                    {t('userAssignmentsPickHint')}
                  </p>
                </div>
              )}
            </aside>
          )}
        </div>
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
      {/* Below lg the details open in a dialog (hidden while editing). */}
      {!panelFits && selected && (
        <Dialog
          open={!editing}
          onOpenChange={(open) => {
            if (!open) setSelectedId(null)
          }}
          title={selected.full_name}
          description={roleLabel(selected)}
          size="sm"
        >
          {details(selected)}
        </Dialog>
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
