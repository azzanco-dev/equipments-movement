import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { AsyncMultiSelect } from '@/components/AsyncMultiSelect'
import { PasswordInput } from '@/components/PasswordInput'
import { Select, type SelectOption } from '@/components/Select'
import { InlineSpinner } from '@/components/Spinner'
import { useI18n } from '@/i18n/I18nContext'
import { localizedName } from '@/lib/localizedName'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import type { Profile, UserRole } from '@/lib/types'

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
    { value: 'admin', label: t('admin') },
  ]

  const callManageUser = useCallback(async (body: Record<string, unknown>) => {
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
        body: JSON.stringify(body),
      },
    )
    const result = await response.json()
    if (!response.ok) throw new Error('request failed')
    return result
  }, [])

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
      } catch {
        if (active) setError(t('userUpdateError'))
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
  }, [callManageUser, lang, t, userId])

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
    } catch {
      setError(t('userUpdateError'))
    } finally {
      setSaving(false)
    }
  }

  function handleBack() {
    if (hasUnsavedChanges && !confirm(t('unsavedChanges'))) return
    onBack()
  }

  if (loading) return <InlineSpinner label={t('loading')} />

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button
        type="button"
        onClick={handleBack}
        className="btn-ghost gap-1 px-1"
      >
        <ArrowRight size={16} className={lang === 'en' ? 'rotate-180' : ''} />
        {t('back')}
      </button>
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t('userDetails')}</h1>
        {user && (
          <p className="mt-0.5 text-[13px] text-muted">{user.full_name}</p>
        )}
      </div>
      <div className="card space-y-4">
        {error && <Alert type="error">{error}</Alert>}
        {hasUnsavedChanges && (
          <Alert type="warning">{t('unsavedChanges')}</Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">{t('fullName')} *</label>
            <input
              className="input"
              autoComplete="off"
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
                if (value !== 'supervisor') setCompanies([])
              }}
              options={roleOptions}
            />
          </div>
          <div>
            <label className="label">{t('temporaryPassword')}</label>
            <PasswordInput
              dir="ltr"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="mt-1 text-xs text-muted">
              {t('temporaryPasswordHelp')}
            </p>
          </div>
        </div>
        {role === 'supervisor' && (
          <div>
            <label className="label">{t('assignedCompanies')}</label>
            <AsyncMultiSelect
              value={companies}
              onChange={setCompanies}
              loadOptions={loadCompanies}
              placeholder={t('selectCompanies')}
            />
            <p className="mt-1 text-xs text-muted">
              {t('assignedCompaniesHelp')}
            </p>
          </div>
        )}
        {user?.must_change_password && (
          <Alert type="warning">{t('mustChangePassword')}</Alert>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={handleBack} className="btn-outline">
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>
  )
}
