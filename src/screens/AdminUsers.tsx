import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Alert } from '@/components/Alert'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { useDataListState } from '@/components/data-list/useDataListState'
import { Modal } from '@/components/Modal'
import { PageHeader } from '@/components/PageHeader'
import { PasswordInput } from '@/components/PasswordInput'
import { RelativeTime } from '@/components/RelativeTime'
import { Select } from '@/components/Select'
import { InlineSpinner } from '@/components/Spinner'
import { useI18n } from '@/i18n/I18nContext'
import { applyListFilters } from '@/lib/applyListFilters'
import { usersListConfig } from '@/lib/listConfigs'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import type { Profile, UserRole } from '@/lib/types'

interface AdminUsersProps {
  onSelectUser: (id: string) => void
}

export function AdminUsers({ onSelectUser }: AdminUsersProps) {
  const { t } = useI18n()
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const list = useDataListState(usersListConfig)
  const [modalOpen, setModalOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('supervisor')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('profiles')
      .select('id,full_name,role,project_id,must_change_password,created_at', {
        count: 'exact',
      })
      .order(list.sort, { ascending: list.direction === 'asc' })
      .range((list.page - 1) * list.pageSize, list.page * list.pageSize - 1)
    const term = sanitizeSearchTerm(list.search)
    if (term) query = query.ilike('full_name', `%${term}%`)
    query = applyListFilters(
      query,
      list.filters,
      new Set(usersListConfig.filterFields.map((field) => field.key)),
    )
    const { data, error, count } = await query
    if (error) console.error(error)
    setUsers((data as Profile[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [
    list.direction,
    list.filters,
    list.page,
    list.pageSize,
    list.search,
    list.sort,
  ])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const roleLabel = (value: UserRole) =>
    value === 'admin'
      ? t('admin')
      : value === 'workshop'
        ? t('workshopOfficer')
        : value === 'assistant_workshop_manager'
          ? t('assistantWorkshopManager')
          : value === 'workshop_manager'
            ? t('workshopManager')
            : t('supervisor')
  const roleOptions = [
    { value: 'supervisor', label: t('supervisor') },
    { value: 'workshop', label: t('workshopOfficer') },
    {
      value: 'assistant_workshop_manager',
      label: t('assistantWorkshopManager'),
    },
    { value: 'workshop_manager', label: t('workshopManager') },
    { value: 'admin', label: t('admin') },
  ]

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
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            email: email.trim(),
            password,
            full_name: fullName.trim(),
            role,
          }),
        },
      )
      const result = await response.json()
      if (!response.ok) {
        if (result.code === 'email_exists') throw new Error('email_exists')
        if (result.code === 'invalid_email') throw new Error('invalid_email')
        if (result.code === 'weak_password') throw new Error('weak_password')
        throw new Error('create_failed')
      }
      setModalOpen(false)
      onSelectUser(result.user.id)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setFormError(
        code === 'email_exists'
          ? t('userEmailExists')
          : code === 'invalid_email'
            ? t('invalidUserEmail')
            : code === 'weak_password'
              ? t('passwordMinLength')
              : t('userCreateError'),
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(user: Profile) {
    if (user.id === currentUser?.id || !confirm(t('confirmDelete'))) return
    const { error } = await supabase.from('profiles').delete().eq('id', user.id)
    if (error) console.error(error)
    fetchUsers()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('users')}
        description={t('usersDesc')}
        actions={
          <DataListActions
            primaryAction={
              <button onClick={openAdd} className="btn-primary">
                <Plus size={18} /> {t('addUser')}
              </button>
            }
          />
        }
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
      {loading ? (
        <InlineSpinner label={t('loading')} />
      ) : users.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-muted">{t('noUsers')}</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="compact-table w-full text-sm">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <th className="table-header px-4 py-3 text-start">
                    {t('fullName')}
                  </th>
                  <th className="table-header px-4 py-3 text-start">
                    {t('role')}
                  </th>
                  <th className="table-header px-4 py-3 text-start">
                    {t('actions')}
                  </th>
                  <th
                    className="table-header px-4 py-3"
                    aria-label={t('createdAt')}
                  />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => onSelectUser(user.id)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onSelectUser(user.id)
                    }}
                  >
                    <td className="px-4 py-3 font-semibold">
                      {user.full_name}
                      {user.id === currentUser?.id ? ` (${t('you')})` : ''}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {roleLabel(user.role)}
                    </td>
                    <td
                      className="px-4 py-3"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {user.id !== currentUser?.id && (
                        <button
                          onClick={() => handleDelete(user)}
                          className="btn-ghost p-1.5"
                          aria-label={t('delete')}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RelativeTime value={user.created_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <DataListPagination
        page={list.page}
        pageSize={list.pageSize}
        total={total}
        onPage={list.setPage}
      />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('addUser')}
        size="sm"
      >
        {formError && (
          <div className="mb-4">
            <Alert type="error">{formError}</Alert>
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="label">{t('fullName')} *</label>
            <input
              className="input"
              autoComplete="off"
              placeholder={t('fullNamePlaceholder')}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('email')} *</label>
            <input
              className="input"
              type="email"
              dir="ltr"
              autoComplete="off"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('password')} *</label>
            <PasswordInput
              dir="ltr"
              autoComplete="new-password"
              placeholder={t('passwordPlaceholder')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('role')}</label>
            <Select
              value={role}
              onChange={(value) => setRole(value as UserRole)}
              options={roleOptions}
            />
          </div>
        </div>
        <div className="flex gap-3 pt-4">
          <button
            onClick={() => setModalOpen(false)}
            className="btn-outline flex-1"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex-1"
          >
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
