import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import { useAuth } from '@/auth/AuthContext'
import { Modal } from '@/components/Modal'
import { Alert } from '@/components/Alert'
import { InlineSpinner } from '@/components/Spinner'
import { Plus, Trash2, X } from 'lucide-react'
import type { Profile, UserRole } from '@/lib/types'
import { Select } from '@/components/Select'
import { PageHeader } from '@/components/PageHeader'
import { DataListToolbar } from '@/components/data-list/DataListToolbar'
import { DataListActions } from '@/components/data-list/DataListActions'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { useDataListState } from '@/components/data-list/useDataListState'
import { usersListConfig } from '@/lib/listConfigs'
import { applyListFilters } from '@/lib/applyListFilters'
import { sanitizeSearchTerm } from '@/lib/search'
import { PasswordInput } from '@/components/PasswordInput'
import { RelativeTime } from '@/components/RelativeTime'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
import type { SelectOption } from '@/components/Select'
import { localizedName } from '@/lib/localizedName'

export function AdminUsers() {
  const { t, lang } = useI18n()
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
  const [assignedProjects, setAssignedProjects] = useState<SelectOption[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [editingUser, setEditingUser] = useState<Profile | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('profiles')
      .select('id,full_name,role,project_id,created_at', { count: 'exact' })
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

  function openAdd() {
    setEmail('')
    setPassword('')
    setFullName('')
    setRole('supervisor')
    setAssignedProjects([])
    setFormError(null)
    setModalOpen(true)
  }

  const loadProjects = useCallback(
    async (search: string): Promise<SelectOption[]> => {
      let query = supabase
        .from('projects')
        .select('id,name_ar,name_en')
        .order(lang === 'ar' ? 'name_ar' : 'name_en')
        .limit(20)
      const term = sanitizeSearchTerm(search)
      if (term)
        query = query.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data } = await query
      return (data ?? []).map((project) => ({
        value: project.id,
        label: localizedName(lang, project.name_ar, project.name_en),
      }))
    },
    [lang],
  )

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

  async function openDetails(profile: Profile) {
    setEditingUser(profile)
    setDetailsLoading(true)
    setFormError(null)
    setPassword('')
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/manage-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action: 'get', user_id: profile.id }),
        },
      )
      const result = await response.json()
      if (!response.ok) throw new Error('load failed')
      setEditingUser(result.user as Profile)
      setFullName(result.user.full_name)
      setEmail(result.user.email)
      setRole(result.user.role)
      setAssignedProjects(
        (result.user.assigned_projects ?? []).map(
          (project: { id: string; name_ar: string; name_en: string }) => ({
            value: project.id,
            label: localizedName(lang, project.name_ar, project.name_en),
          }),
        ),
      )
    } catch {
      setFormError(t('userUpdateError'))
    } finally {
      setDetailsLoading(false)
    }
  }

  async function handleUpdate() {
    if (!editingUser) return
    if (role === 'supervisor' && !assignedProjects.length) {
      setFormError(t('foremanProjectRequired'))
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/manage-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            action: 'update',
            user_id: editingUser.id,
            full_name: fullName.trim(),
            email: email.trim(),
            password,
            role,
            project_ids:
              role === 'supervisor'
                ? assignedProjects.map((project) => project.value)
                : [],
          }),
        },
      )
      if (!response.ok) throw new Error('update failed')
      setEditingUser(null)
      await fetchUsers()
    } catch {
      setFormError(t('userUpdateError'))
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    setFormError(null)
    if (!fullName.trim() || !email.trim() || !password) {
      setFormError(t('userFieldsRequired'))
      return
    }
    if (role === 'supervisor' && !assignedProjects.length) {
      setFormError(t('foremanProjectRequired'))
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
            project_ids:
              role === 'supervisor'
                ? assignedProjects.map((project) => project.value)
                : [],
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
      fetchUsers()
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
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

  async function handleDelete(u: Profile) {
    if (u.id === currentUser?.id) return
    if (!confirm(t('confirmDelete'))) return
    const { error } = await supabase.from('profiles').delete().eq('id', u.id)
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
        <div className="card text-center py-12">
          <p className="text-muted">{t('noUsers')}</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="compact-table w-full text-sm">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <th className="table-header text-start px-4 py-3">
                    {t('fullName')}
                  </th>
                  <th className="table-header text-start px-4 py-3">
                    {t('role')}
                  </th>
                  <th className="table-header text-start px-4 py-3">
                    {t('actions')}
                  </th>
                  <th
                    className="table-header px-4 py-3"
                    aria-label={t('createdAt')}
                  />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => openDetails(u)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') openDetails(u)
                    }}
                  >
                    <td className="px-4 py-3 font-semibold">
                      {u.full_name}
                      {u.id === currentUser?.id ? ' (You)' : ''}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {roleLabel(u.role)}
                    </td>
                    <td
                      className="px-4 py-3"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {u.id !== currentUser?.id && (
                        <button
                          onClick={() => handleDelete(u)}
                          className="btn-ghost p-1.5"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RelativeTime value={u.created_at} />
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
              placeholder={t('fullNamePlaceholder')}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('email')} *</label>
            <input
              className="input"
              type="email"
              dir="ltr"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('password')} *</label>
            <PasswordInput
              dir="ltr"
              placeholder={t('passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('role')}</label>
            <Select
              value={role}
              onChange={(v) => setRole(v as UserRole)}
              options={roleOptions}
            />
          </div>
          {role === 'supervisor' && (
            <ProjectAssignments
              projects={assignedProjects}
              setProjects={setAssignedProjects}
              loadProjects={loadProjects}
              label={t('assignedProject')}
            />
          )}
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
      <Modal
        open={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
        title={t('userDetails')}
        size="sm"
      >
        {formError && (
          <div className="mb-4">
            <Alert type="error">{formError}</Alert>
          </div>
        )}
        {detailsLoading ? (
          <InlineSpinner label={t('loading')} />
        ) : (
          <div className="space-y-4">
            <div>
              <label className="label">{t('fullName')} *</label>
              <input
                className="input"
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
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div>
              <label className="label">{t('role')}</label>
              <Select
                value={role}
                onChange={(value) => {
                  setRole(value as UserRole)
                  if (value !== 'supervisor') setAssignedProjects([])
                }}
                options={roleOptions}
              />
            </div>
            {role === 'supervisor' && (
              <ProjectAssignments
                projects={assignedProjects}
                setProjects={setAssignedProjects}
                loadProjects={loadProjects}
                label={t('assignedProject')}
              />
            )}
            <div>
              <label className="label">{t('temporaryPassword')}</label>
              <PasswordInput
                dir="ltr"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="mt-1 text-xs text-muted">
                {t('temporaryPasswordHelp')}
              </p>
            </div>
            {editingUser?.must_change_password && (
              <Alert type="warning">{t('mustChangePassword')}</Alert>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEditingUser(null)}
                className="btn-outline flex-1"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleUpdate}
                disabled={saving}
                className="btn-primary flex-1"
              >
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function ProjectAssignments({
  projects,
  setProjects,
  loadProjects,
  label,
}: {
  projects: SelectOption[]
  setProjects: (projects: SelectOption[]) => void
  loadProjects: (query: string) => Promise<SelectOption[]>
  label: string
}) {
  return (
    <div className="space-y-2">
      <label className="label">{label} *</label>
      <AsyncSearchSelect
        value=""
        selectedOption={null}
        onChange={(_, option) => {
          if (
            option &&
            !projects.some((project) => project.value === option.value)
          )
            setProjects([...projects, option])
        }}
        loadOptions={loadProjects}
      />
      {projects.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {projects.map((project) => (
            <span
              key={project.value}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--border)' }}
            >
              {project.label}
              <button
                type="button"
                className="text-muted hover:text-red-600"
                onClick={() =>
                  setProjects(
                    projects.filter((item) => item.value !== project.value),
                  )
                }
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
