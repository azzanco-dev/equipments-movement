import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Users } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { usePermissions } from '@/auth/PermissionsContext'
import { usersActions } from '@/lib/actionPermissions'
import { useActiveRoles } from '@/components/roles/useActiveRoles'
import { roleName } from '@/components/roles/roleRows'
import type { FilterField } from '@/components/data-list/types'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  PageHeader,
  Select,
  useConfirm,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
// Imported directly: Notice is not yet wired into the `ui` barrel
// (src/components/ui/index.ts), which is owned separately.
import { Notice } from '@/components/ui/Notice'
import { PasswordInput } from '@/components/PasswordInput'
import { RelativeTime } from '@/components/RelativeTime'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { usersListConfig } from '@/lib/listConfigs'
import { buildSearchFilter } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import { callEdgeFunction, EdgeFunctionError } from '@/lib/edgeFunction'
import { localizedName } from '@/lib/localizedName'
import {
  assignedRoleFromEmbed,
  isSystemRoleKey,
  type AssignedRole,
} from '@/lib/userRoleAssignment'
import {
  EMPTY_USER_FORM,
  roleBadge,
  USER_FIELD_ORDER,
  USER_ROLES,
  userServerFieldErrors,
  validateUserForm,
  type UserFormValues,
} from '@/lib/userForm'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  type FieldErrors,
} from '@/lib/formValidation'
import type { Profile } from '@/lib/types'

interface AdminUsersProps {
  onSelectUser: (id: string) => void
}

/** A list row: the profile plus its assignment (null when it has none). */
type UserRow = Profile & { assignedRole: AssignedRole | null }

/** The embedded assignment, read with the profile. */
const ASSIGNMENT_EMBED =
  'profile_roles!profile_id(role_key,roles(name_ar,name_en))'
/** The same embed as an inner join, for a filter on the assigned role. */
const ASSIGNMENT_EMBED_INNER =
  'profile_roles!profile_id!inner(role_key,roles(name_ar,name_en))'
const ASSIGNED_ROLE_COLUMN = 'profile_roles.role_key'

export function AdminUsers({ onSelectUser }: AdminUsersProps) {
  const { t, lang } = useI18n()
  const { user: currentUser } = useAuth()
  // The list shows and the dialog assigns the `profile_roles` role (roles
  // stage 4c-2, migration 0156: the legacy profiles.role is gone).
  const permissionState = usePermissions()
  // wave 24: adding and deleting users follow `users.manage` (nobody
  // while the permissions load or after a failed load); the page gate and
  // the database (0127) require the same key.
  const canManageUsers = usersActions(permissionState).manage
  const { roles: activeRoles } = useActiveRoles(true)
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const list = useDataListState(usersListConfig)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<UserFormValues>(EMPTY_USER_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors<UserFormValues>>({})
  // Set when `create-user` succeeded but the custom role could not be
  // assigned: the user exists, so the dialog must not create him again.
  const [createdUserId, setCreatedUserId] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  /** Editing a field clears its message; nothing is validated while typing. */
  const update = (patch: Partial<UserFormValues>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors((current) =>
      clearFieldErrors(current, Object.keys(patch) as (keyof UserFormValues)[]),
    )
  }
  const { confirm, confirmDialog } = useConfirm()

  const startListRequest = useListRequest()
  const fetchUsers = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(null)
    // The role filter applies to the assignment (`profile_roles.role_key`);
    // an inner join is needed for PostgREST to filter the parent rows by it,
    // so it is used only while such a filter is active (otherwise users
    // without an assignment would disappear).
    const filters = list.filters.map((filter) =>
      filter.field === 'role'
        ? { ...filter, field: ASSIGNED_ROLE_COLUMN }
        : filter,
    )
    const filtersAssignment = filters.some(
      (filter) => filter.field === ASSIGNED_ROLE_COLUMN,
    )
    const columns = `id,full_name,must_change_password,created_at,${filtersAssignment ? ASSIGNMENT_EMBED_INNER : ASSIGNMENT_EMBED}`
    let query = supabase
      .from('profiles')
      .select(columns, { count: 'exact' })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .order('id', { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const searchFilter = buildSearchFilter(
      usersListConfig.searchFields,
      list.search,
    )
    if (searchFilter) query = query.or(searchFilter)
    query = applyListFilters(
      query,
      filters,
      new Set([
        ...usersListConfig.filterFields.map((field) => field.key),
        ASSIGNED_ROLE_COLUMN,
      ]),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) setLoadError(t('usersLoadError'))
    const rows =
      (data as unknown as Array<
        Profile & { profile_roles?: unknown }
      > | null) ?? []
    setUsers(
      rows.map(({ profile_roles, ...profile }) => ({
        ...profile,
        assignedRole: assignedRoleFromEmbed(profile_roles),
      })),
    )
    setTotal(count ?? 0)
    setLoading(false)
  }, [
    list.direction,
    startListRequest,
    list.filters,
    list.page,
    list.pageSize,
    list.search,
    list.sort,
    t,
  ])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  // The active roles, the original ones first (`useActiveRoles`). Until they
  // load, or when they could not be read, the six original roles (their
  // values are role keys too) keep the dialog usable; create-user checks
  // that the chosen role exists and is active.
  const roleOptions = activeRoles
    ? activeRoles.map((role) => ({
        value: role.key,
        label: roleName(lang, role),
      }))
    : USER_ROLES.map((value) => ({
        value,
        label: t(roleBadge(value).key),
      }))

  // The role filter: the active roles (runtime labels in the active
  // language) once read, the six original roles until then.
  const filterFields = useMemo<FilterField[]>(
    () =>
      activeRoles
        ? usersListConfig.filterFields.map((field) =>
            field.key === 'role'
              ? {
                  ...field,
                  options: activeRoles.map((role) => ({
                    value: role.key,
                    label: roleName(lang, role),
                  })),
                }
              : field,
          )
        : usersListConfig.filterFields,
    [activeRoles, lang],
  )

  function openAdd() {
    setForm(EMPTY_USER_FORM)
    setCreatedUserId(null)
    setFormError(null)
    setErrors({})
    setModalOpen(true)
  }

  async function handleSave() {
    if (createdUserId) return
    setFormError(null)
    // The chosen role key is checked like the other fields (present); the
    // Edge Function checks that it exists and is active.
    const invalid = validateUserForm(form)
    if (hasErrors(invalid)) {
      setErrors(invalid)
      focusFirstError(invalid, USER_FIELD_ORDER, { root: bodyRef.current })
      return
    }
    setSaving(true)
    try {
      // Roles stage 4c (owner 2026-10-27): create-user assigns the chosen
      // role itself (admin_assign_profile_role as the caller). A failed
      // assignment never undoes the account: the role is then set on the
      // user's page.
      const result = await callEdgeFunction<{
        user: { id: string }
        role_assigned?: boolean
      }>('create-user', {
        email: form.email.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        role_key: form.role,
      })
      if (result.role_assigned === false) {
        setCreatedUserId(result.user.id)
        const partial: FieldErrors<UserFormValues> = {
          role: 'userCreatedRoleNotAssigned',
        }
        setErrors(partial)
        focusFirstError(partial, USER_FIELD_ORDER, { root: bodyRef.current })
        return
      }
      setModalOpen(false)
      onSelectUser(result.user.id)
    } catch (error) {
      const code =
        error instanceof EdgeFunctionError ? error.serverCode : undefined
      // A rejected email or password belongs on that field; every other
      // failure stays a safe top-level message.
      const attributed = userServerFieldErrors(code)
      if (attributed) {
        setErrors(attributed)
        focusFirstError(attributed, USER_FIELD_ORDER, { root: bodyRef.current })
        return
      }
      setFormError(
        error instanceof EdgeFunctionError && error.code === 'network'
          ? t('networkConnectionError')
          : error instanceof EdgeFunctionError &&
              error.code === 'sessionExpired'
            ? t('sessionExpiredError')
            : error instanceof EdgeFunctionError && error.code === 'forbidden'
              ? t('userPermissionError')
              : error instanceof EdgeFunctionError && error.code === 'server'
                ? t('serverTemporaryError')
                : t('userCreateError'),
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(user: Profile) {
    if (
      user.id === currentUser?.id ||
      !(await confirm({
        title: t('confirmDeleteTitle'),
        description: `${t('confirmDeleteQuestion')} ${t('dialogDescUserDelete')}`,
        tone: 'danger',
      }))
    )
      return
    const { error } = await supabase.from('profiles').delete().eq('id', user.id)
    if (error) {
      // 23503 = foreign_key_violation: the user still owns photos, driver
      // changes or movements (migration 0109 made the photo link RESTRICT).
      // Only the SQLSTATE is read; the raw message never reaches the user.
      setLoadError(
        t(error.code === '23503' ? 'userDeleteHasRecords' : 'userDeleteError'),
      )
      return
    }
    fetchUsers()
  }

  const columns: DataTableColumn<UserRow>[] = [
    {
      key: 'full_name',
      header: t('fullName'),
      sortable: true,
      className: 'font-semibold',
      cell: (row) => (
        <>
          {row.full_name}
          {row.id === currentUser?.id ? ` (${t('you')})` : ''}
        </>
      ),
    },
    {
      key: 'role',
      header: t('role'),
      // The column shows the assigned role, an embed the users cannot be
      // sorted by, so it is not sortable (roles stage 3).
      sortable: false,
      cell: (row) => {
        // The assigned role's name; a user without assignment holds nothing.
        if (row.assignedRole)
          return (
            <Badge
              tone={
                isSystemRoleKey(row.assignedRole.key)
                  ? roleBadge(row.assignedRole.key).tone
                  : 'neutral'
              }
            >
              {localizedName(
                lang,
                row.assignedRole.name_ar,
                row.assignedRole.name_en,
              )}
            </Badge>
          )
        return <Badge tone="danger">{t('roleUsersNoRole')}</Badge>
      },
    },
    {
      key: 'actions',
      header: t('actions'),
      cell: (row) =>
        row.id === currentUser?.id || !canManageUsers ? null : (
          <IconButton
            size="sm"
            label={t('delete')}
            title={t('delete')}
            icon={<Trash2 size={16} />}
            onClick={() => handleDelete(row)}
          />
        ),
    },
    {
      key: 'created_at',
      header: t('createdAt'),
      sortable: true,
      className: 'text-muted',
      hideBelow: 'md',
      cell: (row) => <RelativeTime value={row.created_at} />,
    },
  ]

  const addButton = (
    <Button
      variant="primary"
      icon={<Plus size={16} aria-hidden="true" />}
      onClick={openAdd}
    >
      {t('addUser')}
    </Button>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('users')}
        description={t('usersDesc')}
        actions={
          canManageUsers ? (
            <DataListActions primaryAction={addButton} />
          ) : undefined
        }
      />
      <DataListToolbar
        config={usersListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        filterFields={filterFields}
        filters={list.filters}
        onFilters={list.setFilters}
      />
      {loadError ? (
        <ErrorState description={loadError} onRetry={fetchUsers} />
      ) : !loading && users.length === 0 ? (
        <EmptyState
          icon={<Users size={28} aria-hidden="true" />}
          title={t('noUsers')}
          action={addButton}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={users}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={6}
          caption={t('users')}
          sort={{ key: list.sort, direction: list.direction }}
          onSortChange={list.setSort}
          onRowClick={(row) => onSelectUser(row.id)}
          rowHref={(row) => `/users/${row.id}`}
          empty={t('noUsers')}
        />
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

      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={t('addUser')}
        description={t('dialogDescUserAdd')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              {t('cancel')}
            </Button>
            {createdUserId ? (
              <Button
                variant="primary"
                onClick={() => {
                  setModalOpen(false)
                  onSelectUser(createdUserId)
                }}
              >
                {t('userOpenPage')}
              </Button>
            ) : (
              <Button variant="primary" loading={saving} onClick={handleSave}>
                {t('save')}
              </Button>
            )}
          </>
        }
      >
        <div ref={bodyRef} className="space-y-4">
          {formError && <Notice tone="danger">{formError}</Notice>}
          {createdUserId && (
            <Notice tone="warning">{t('userCreatedRoleNotAssigned')}</Notice>
          )}
          <Field
            label={t('fullName')}
            name="full_name"
            required
            error={errors.full_name && t(errors.full_name)}
          >
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                placeholder={t('fullNamePlaceholder')}
                value={form.full_name}
                onChange={(event) => update({ full_name: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={t('email')}
            name="email"
            required
            error={errors.email && t(errors.email)}
          >
            {(control) => (
              <Input
                {...control}
                type="email"
                dir="ltr"
                autoComplete="off"
                placeholder={t('emailPlaceholder')}
                value={form.email}
                onChange={(event) => update({ email: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={t('password')}
            name="password"
            required
            error={errors.password && t(errors.password)}
          >
            {(control) => (
              <PasswordInput
                {...control}
                autoComplete="new-password"
                placeholder={t('passwordPlaceholder')}
                value={form.password}
                onChange={(event) => update({ password: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={t('role')}
            name="role"
            hint={t('userRoleManagedInSettings')}
            error={errors.role && t(errors.role)}
          >
            {(control) => (
              <Select
                {...control}
                value={form.role}
                disabled={Boolean(createdUserId)}
                onValueChange={(value) => update({ role: value })}
                options={roleOptions}
              />
            )}
          </Field>
        </div>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
