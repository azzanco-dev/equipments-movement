import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert } from '@/components/Alert'
import { AsyncMultiSelect } from '@/components/AsyncMultiSelect'
import { PasswordInput } from '@/components/PasswordInput'
import type { SelectOption } from '@/components/Select'
import { useI18n } from '@/i18n/I18nContext'
import { localizedName } from '@/lib/localizedName'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import { callEdgeFunction, EdgeFunctionError } from '@/lib/edgeFunction'
import type { Profile, UserRole } from '@/lib/types'
import {
  Badge,
  Button,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  useConfirm,
} from '@/components/ui'

interface UserDetailProps {
  userId: string
  onBack: () => void
}

function formSnapshot(
  fullName: string,
  email: string,
  password: string,
  role: UserRole,
  companies: SelectOption[],
) {
  return JSON.stringify({
    fullName,
    email,
    password,
    role,
    companyIds: companies.map((company) => company.value).sort(),
  })
}

export function UserDetail({ userId, onBack }: UserDetailProps) {
  const { t, lang } = useI18n()
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('supervisor')
  const [companies, setCompanies] = useState<SelectOption[]>([])
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const currentSnapshot = useMemo(
    () => formSnapshot(fullName, email, password, role, companies),
    [companies, email, fullName, password, role],
  )
  const hasUnsavedChanges =
    savedSnapshot !== null && currentSnapshot !== savedSnapshot

  const roleOptions = [
    { value: 'supervisor', label: t('supervisor') },
    { value: 'workshop', label: t('workshopOfficer') },
    {
      value: 'assistant_workshop_manager',
      label: t('assistantWorkshopManager'),
    },
    { value: 'workshop_manager', label: t('workshopManager') },
    { value: 'monitor', label: t('monitoring') },
    { value: 'admin', label: t('admin') },
  ]

  const callManageUser = useCallback(
    (body: Record<string, unknown>) =>
      callEdgeFunction<{ user: Profile }>('manage-user', body),
    [],
  )

  const errorMessage = useCallback(
    (cause: unknown) => {
      if (!(cause instanceof EdgeFunctionError)) return t('userUpdateError')
      if (cause.code === 'network') return t('networkConnectionError')
      if (cause.code === 'sessionExpired') return t('sessionExpiredError')
      if (cause.code === 'forbidden') return t('userPermissionError')
      if (cause.code === 'notFound') return t('userNotFound')
      if (cause.code === 'server') return t('serverTemporaryError')
      if (cause.serverCode === 'own_role') return t('cannotChangeOwnRole')
      if (cause.serverCode === 'last_admin') return t('lastAdminRequired')
      return t('userUpdateError')
    },
    [t],
  )

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const result = await callManageUser({ action: 'get', user_id: userId })
        if (!active) return
        const loadedUser = result.user as Profile
        setUser(loadedUser)
        setFullName(loadedUser.full_name)
        setEmail(loadedUser.email ?? '')
        setRole(loadedUser.role)
        const assignedCompanies = (loadedUser.assigned_companies ?? []).map(
          (company) => ({
            value: company.id,
            label: localizedName(lang, company.name_ar, company.name_en),
          }),
        )
        setCompanies(assignedCompanies)
        setSavedSnapshot(
          formSnapshot(
            loadedUser.full_name,
            loadedUser.email ?? '',
            '',
            loadedUser.role,
            assignedCompanies,
          ),
        )
      } catch (cause) {
        if (active) setError(errorMessage(cause))
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [callManageUser, errorMessage, lang, userId])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges])

  const loadCompanies = useCallback(
    async (search: string): Promise<SelectOption[]> => {
      let query = supabase
        .from('companies')
        .select('id,name_ar,name_en')
        .order(lang === 'ar' ? 'name_ar' : 'name_en')
        .limit(20)
      const term = sanitizeSearchTerm(search)
      if (term)
        query = query.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data } = await query
      return (data ?? []).map((company) => ({
        value: company.id,
        label: localizedName(lang, company.name_ar, company.name_en),
      }))
    },
    [lang],
  )

  const loadAllCompanies = useCallback(async (): Promise<SelectOption[]> => {
    const { data } = await supabase
      .from('companies')
      .select('id,name_ar,name_en')
      .order(lang === 'ar' ? 'name_ar' : 'name_en')
    return (data ?? []).map((company) => ({
      value: company.id,
      label: localizedName(lang, company.name_ar, company.name_en),
    }))
  }, [lang])

  async function handleSave() {
    setError(null)
    if (!fullName.trim() || !email.trim()) {
      setError(t('userFieldsRequired'))
      return
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError(t('invalidUserEmail'))
      return
    }
    if (password && password.length < 8) {
      setError(t('passwordMinLength'))
      return
    }
    setSaving(true)
    try {
      const nextFullName = fullName.trim()
      const nextEmail = email.trim()
      await callManageUser({
        action: 'update',
        user_id: userId,
        full_name: nextFullName,
        email: nextEmail,
        password,
        role,
        company_ids:
          role === 'supervisor' ? companies.map((item) => item.value) : [],
      })
      setFullName(nextFullName)
      setEmail(nextEmail)
      setPassword('')
      setUser((current) =>
        current ? { ...current, full_name: nextFullName } : current,
      )
      setSavedSnapshot(
        formSnapshot(nextFullName, nextEmail, '', role, companies),
      )
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  async function handleBack() {
    if (
      hasUnsavedChanges &&
      !(await confirm({ title: t('unsavedChanges'), tone: 'danger' }))
    )
      return
    onBack()
  }

  if (loading)
    return (
      <div
        className="space-y-2 py-2"
        aria-busy="true"
        aria-label={t('loading')}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-4/5" />
      </div>
    )

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        onBack={handleBack}
        backLabel={t('back')}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {t('userDetails')}
            {hasUnsavedChanges && (
              <Badge tone="warning">{t('unsavedData')}</Badge>
            )}
            {user?.must_change_password && (
              <Badge tone="warning">{t('mustChangePassword')}</Badge>
            )}
          </span>
        }
        description={user?.full_name}
      />
      <div className="card space-y-4">
        {error && <Alert type="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('fullName')} required>
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
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
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Field label={t('role')}>
            {(control) => (
              <Select
                {...control}
                value={role}
                onValueChange={(value) => {
                  setRole(value as UserRole)
                  if (value !== 'supervisor') setCompanies([])
                }}
                options={roleOptions}
              />
            )}
          </Field>
          <Field
            label={t('temporaryPassword')}
            hint={t('temporaryPasswordHelp')}
          >
            {({ id }) => (
              <PasswordInput
                id={id}
                dir="ltr"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
        </div>
        {role === 'supervisor' && (
          <Field
            label={t('assignedCompanies')}
            hint={t('assignedCompaniesHelp')}
          >
            {() => (
              <AsyncMultiSelect
                value={companies}
                onChange={setCompanies}
                loadOptions={loadCompanies}
                loadAllOptions={loadAllCompanies}
                placeholder={t('selectCompanies')}
              />
            )}
          </Field>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={handleBack}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            {t('save')}
          </Button>
        </div>
      </div>
      {confirmDialog}
    </div>
  )
}
