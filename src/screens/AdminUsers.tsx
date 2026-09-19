import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Users } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
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
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import { callEdgeFunction, EdgeFunctionError } from '@/lib/edgeFunction'
import { roleBadge, USER_ROLES } from '@/lib/userForm'
import type { Profile, UserRole } from '@/lib/types'

interface AdminUsersProps {
  onSelectUser: (id: string) => void
}

export function AdminUsers({ onSelectUser }: AdminUsersProps) {
  const { t } = useI18n()
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const list = useDataListState(usersListConfig)
  const [modalOpen, setModalOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('supervisor')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const startListRequest = useListRequest()
  const fetchUsers = useCallback(async () => {
    const signal = startListRequest()
    setLoading(true)
    setLoadError(null)
    let query = supabase
      .from('profiles')
      .select('id,full_name,role,must_change_password,created_at', {
        count: 'exact',
      })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .order('id', { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const term = sanitizeSearchTerm(list.search)
    if (term) query = query.ilike('full_name', `%${term}%`)
    query = applyListFilters(
      query,
      list.filters,
      new Set(usersListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) setLoadError(t('usersLoadError'))
    setUsers((data as Profile[]) ?? [])
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

  const roleOptions = USER_ROLES.map((value) => ({
    value,
    label: t(roleBadge(value).key),
  }))

  function openAdd() {
    setEmail('')
    setPassword('')
    setFullName('')
    setRole('supervisor')
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSave() {
    setFormError(null)
    if (!fullName.trim() || !email.trim() || !password) {
      setFormError(t('userFieldsRequired'))
      return
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setFormError(t('invalidUserEmail'))
      return
    }
    if (password.length < 8) {
      setFormError(t('passwordMinLength'))
      return
    }
    setSaving(true)
    try {
      const result = await callEdgeFunction<{ user: { id: string } }>(
        'create-user',
        {
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          role,
        },
      )
      setModalOpen(false)
      onSelectUser(result.user.id)
    } catch (error) {
      const code =
        error instanceof EdgeFunctionError ? error.serverCode : undefined
      setFormError(
        code === 'email_exists'
          ? t('userEmailExists')
          : code === 'invalid_email'
            ? t('invalidUserEmail')
            : code === 'weak_password'
              ? t('passwordMinLength')
              : error instanceof EdgeFunctionError && error.code === 'network'
                ? t('networkConnectionError')
                : error instanceof EdgeFunctionError &&
                    error.code === 'sessionExpired'
                  ? t('sessionExpiredError')
                  : error instanceof EdgeFunctionError &&
                      error.code === 'forbidden'
                    ? t('userPermissionError')
                    : error instanceof EdgeFunctionError &&
                        error.code === 'server'
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
      !(await confirm({ title: t('confirmDelete'), tone: 'danger' }))
    )
      return
    const { error } = await supabase.from('profiles').delete().eq('id', user.id)
    if (error) {
      setLoadError(t('userDeleteError'))
      return
    }
    fetchUsers()
  }

  const columns: DataTableColumn<Profile>[] = [
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
      sortable: true,
      cell: (row) => {
        const badge = roleBadge(row.role)
        return <Badge tone={badge.tone}>{t(badge.key)}</Badge>
      },
    },
    {
      key: 'actions',
      header: t('actions'),
      cell: (row) =>
        row.id === currentUser?.id ? null : (
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
        actions={<DataListActions primaryAction={addButton} />}
      />
      <DataListToolbar
        config={usersListConfig}
        search={list.searchInput}
        onSearch={list.setSearchInput}
        sort={list.sort}
        direction={list.direction}
        onSort={list.setSort}
        pageSize={list.pageSize}
        onPageSize={list.setPageSize}
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
          empty={t('noUsers')}
        />
      )}
      {!loadError && total > 0 && (
        <DataListPagination
          page={list.page}
          pageSize={list.pageSize}
          total={total}
          onPage={list.setPage}
        />
      )}

      <Dialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={t('addUser')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" loading={saving} onClick={handleSave}>
              {t('save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <Notice tone="danger">{formError}</Notice>}
          <Field label={t('fullName')} required>
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                placeholder={t('fullNamePlaceholder')}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            )}
          </Field>
          <Field label={t('email')} required>
            {(control) => (
              <Input
                {...control}
                type="email"
                dir="ltr"
                autoComplete="off"
                placeholder={t('emailPlaceholder')}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Field label={t('password')} required>
            {(control) => (
              <PasswordInput
                {...control}
                autoComplete="new-password"
                placeholder={t('passwordPlaceholder')}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <Field label={t('role')}>
            {(control) => (
              <Select
                {...control}
                value={role}
                onValueChange={(value) => setRole(value as UserRole)}
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
