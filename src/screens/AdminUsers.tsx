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
  legacyRoleFor,
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
import type { Profile, UserRole } from '@/lib/types'

interface AdminUsersProps {
  onSelectUser: (id: string) => void
}

/** A list row: the profile plus, with the roles system ON, its assignment. */
type UserRow = Profile & { assignedRole: AssignedRole | null }

/** The embedded assignment, read with the profile when the flag is ON. */
const ASSIGNMENT_EMBED =
  'profile_roles!profile_id(role_key,roles(name_ar,name_en))'
/** The same embed as an inner join, for a filter on the assigned role. */
const ASSIGNMENT_EMBED_INNER =
  'profile_roles!profile_id!inner(role_key,roles(name_ar,name_en))'
const ASSIGNED_ROLE_COLUMN = 'profile_roles.role_key'

export function AdminUsers({ onSelectUser }: AdminUsersProps) {
  const { t, lang } = useI18n()
  const { user: currentUser } = useAuth()
  // wave 23 (step 3): with the roles system ON the list shows and the dialog
  // assigns the `profile_roles` role; OFF or unknown keeps the legacy role
  // exactly as before. The active roles are read only while ON.
  const permissionState = usePermissions()
  const { rolesSystemEnabled } = permissionState
  // wave 24: adding and deleting users follow `users.manage` (nobody
  // while the permissions load or after a failed load); the page gate and
  // the database (0127) require the same key.
  const canManageUsers = usersActions(permissionState).manage
  const rolesOn = rolesSystemEnabled === true
  const { roles: activeRoles } = useActiveRoles(rolesOn)
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
  // The assigned role chosen in the dialog while the roles system is ON
  // (`roles.key`); `form.role` keeps the legacy role for the OFF dialog.
  const [roleKey, setRoleKey] = useState<string>(EMPTY_USER_FORM.role)
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
    // With the roles system ON the role filter applies to the assignment
    // (`profile_roles.role_key`); an inner join is needed for PostgREST to
    // filter the parent rows by it, so it is used only while such a filter is
    // active (otherwise users without an assignment would disappear).
    const filters = rolesOn
      ? list.filters.map((filter) =>
          filter.field === 'role'
            ? { ...filter, field: ASSIGNED_ROLE_COLUMN }
            : filter,
        )
      : list.filters
    const filtersAssignment = filters.some(
      (filter) => filter.field === ASSIGNED_ROLE_COLUMN,
    )
    const columns = rolesOn
      ? `id,full_name,role,must_change_password,created_at,${filtersAssignment ? ASSIGNMENT_EMBED_INNER : ASSIGNMENT_EMBED}`
      : 'id,full_name,role,must_change_password,created_at'
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
        ...(rolesOn ? [ASSIGNED_ROLE_COLUMN] : []),
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
        assignedRole: rolesOn ? assignedRoleFromEmbed(profile_roles) : null,
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
    rolesOn,
    t,
  ])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const legacyRoleOptions = USER_ROLES.map((value) => ({
    value,
    label: t(roleBadge(value).key),
  }))
  // ON: the active roles, system roles first (`useActiveRoles`). Until they
  // load, or when they could not be read, the legacy roles — every one of
  // them is an active system role — keep the dialog usable.
  const assignedRoleOptions = rolesOn && activeRoles
  const roleOptions = assignedRoleOptions
    ? assignedRoleOptions.map((role) => ({
        value: role.key,
        label: roleName(lang, role),
      }))
    : legacyRoleOptions

  // The role filter: the assigned roles while ON (runtime labels in the
  // active language), today's legacy options otherwise.
  const filterFields = useMemo<FilterField[]>(
    () =>
      rolesOn && activeRoles
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
    [activeRoles, lang, rolesOn],
  )

  function openAdd() {
    setForm(EMPTY_USER_FORM)
    setRoleKey(EMPTY_USER_FORM.role)
    setCreatedUserId(null)
    setFormError(null)
    setErrors({})
    setModalOpen(true)
  }

  async function handleSave() {
    if (createdUserId) return
    setFormError(null)
    // ON: the account is created with the legacy role derived from the chosen
    // role (`legacyRoleFor`: a system role is itself, a custom role gives a
    // new user `monitor`); a custom role is then assigned in a second step.
    // The roles-system select is shown only once the active roles loaded;
    // until then (or after a failed load) the legacy select and form.role apply.
    const chosenRole = assignedRoleOptions ? roleKey : form.role
    const legacyRole = assignedRoleOptions
      ? legacyRoleFor(chosenRole, null)
      : form.role
    const invalid = validateUserForm({ ...form, role: legacyRole })
    if (hasErrors(invalid)) {
      setErrors(invalid)
      focusFirstError(invalid, USER_FIELD_ORDER, { root: bodyRef.current })
      return
    }
    setSaving(true)
    try {
      const result = await callEdgeFunction<{ user: { id: string } }>(
        'create-user',
        {
          email: form.email.trim(),
          password: form.password,
          full_name: form.full_name.trim(),
          role: legacyRole,
        },
      )
      if (rolesOn && !isSystemRoleKey(chosenRole)) {
        // The user now exists with the derived legacy role (and, through the
        // 0126 trigger, that role as assignment). A failure here is never
        // reported as a failed creation: the role can be set on his page.
        let assigned = false
        try {
          const { error: assignError } = await supabase.rpc(
            'admin_assign_profile_role',
            { p_profile_id: result.user.id, p_role_key: chosenRole },
          )
          assigned = !assignError
        } catch {
          assigned = false
        }
        if (!assigned) {
          setCreatedUserId(result.user.id)
          const partial: FieldErrors<UserFormValues> = {
            role: 'userCreatedRoleNotAssigned',
          }
          setErrors(partial)
          focusFirstError(partial, USER_FIELD_ORDER, { root: bodyRef.current })
          return
        }
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
      // ON: the column shows the assigned role, but sorting could only order
      // by the legacy profiles.role, so it is not offered (roles stage 3).
      sortable: !rolesOn,
      cell: (row) => {
        // ON: the assigned role's name; a user without assignment, and the
        // OFF state, show the legacy badge as before.
        if (rolesOn && row.assignedRole)
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
        const badge = roleBadge(row.role)
        return <Badge tone={badge.tone}>{t(badge.key)}</Badge>
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
            hint={rolesOn ? t('userRoleManagedInSettings') : undefined}
            error={errors.role && t(errors.role)}
          >
            {(control) =>
              assignedRoleOptions ? (
                <Select
                  {...control}
                  value={roleKey}
                  disabled={Boolean(createdUserId)}
                  onValueChange={(value) => {
                    setRoleKey(value)
                    setErrors((current) => clearFieldErrors(current, ['role']))
                  }}
                  options={roleOptions}
                />
              ) : (
                <Select
                  {...control}
                  value={form.role}
                  disabled={Boolean(createdUserId)}
                  onValueChange={(value) => update({ role: value as UserRole })}
                  options={roleOptions}
                />
              )
            }
          </Field>
        </div>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
