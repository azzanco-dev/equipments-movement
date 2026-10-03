import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert } from '@/components/Alert'
import { AsyncMultiSelect } from '@/components/AsyncMultiSelect'
import { PasswordInput } from '@/components/PasswordInput'
import type { SelectOption } from '@/components/Select'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import { localizedName } from '@/lib/localizedName'
import { sanitizeSearchTerm } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import { callEdgeFunction, EdgeFunctionError } from '@/lib/edgeFunction'
import type { Profile, ProfileContact, UserRole } from '@/lib/types'
import {
  isValidUserMobile,
  normalizeUserMobileInput,
  userMobileErrorCode,
} from '@/lib/userMobile'
import {
  BackButton,
  Badge,
  Button,
  DetailHeader,
  ErrorState,
  Field,
  Input,
  InfoGridSection,
  Notice,
  SectionHeader,
  Select,
  Skeleton,
  useConfirm,
  type InfoGridItem,
} from '@/components/ui'
import { InfoGridSkeleton } from '@/components/ui/InfoGrid'

interface UserDetailProps {
  userId: string
  onBack: () => void
}

/** A company option that keeps both names, so its label follows the active
 *  language at render time instead of needing a reload of the user. */
type CompanyOption = SelectOption & { name_ar: string; name_en: string }

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
  // The cause of a failed load, turned into a message at render so it follows
  // the active language without the load depending on it.
  const [loadFailure, setLoadFailure] = useState<{ cause: unknown } | null>(
    null,
  )
  const [reloadKey, setReloadKey] = useState(0)
  // The `userId` the loaded `user` belongs to (null until a load succeeds).
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('supervisor')
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null)
  // wave 9 — the mobile number (migration 0110). It is read and written apart
  // from the rest of the record: the `manage-user` Edge Function neither
  // returns nor updates it, and `admin_set_user_mobile` is its only write
  // path. A failed read is reported on the number alone and never takes the
  // page down.
  const [mobile, setMobile] = useState('')
  const [mobileLoad, setMobileLoad] = useState<{
    userId: string
    state: 'loaded' | 'failed'
    /** The stored number; '' when the user has none. */
    saved: string
  } | null>(null)
  const [mobileReloadKey, setMobileReloadKey] = useState(0)
  const [mobileError, setMobileError] = useState<string | null>(null)
  // The rest of the record was saved but the number was not.
  const [mobileNotSaved, setMobileNotSaved] = useState(false)
  const { confirm, confirmDialog } = useConfirm()

  const currentSnapshot = useMemo(
    () => formSnapshot(fullName, email, password, role, companies),
    [companies, email, fullName, password, role],
  )
  const mainChanged =
    savedSnapshot !== null && currentSnapshot !== savedSnapshot
  // Known only once the number of THIS user was read.
  const mobileState =
    mobileLoad?.userId === userId ? mobileLoad.state : 'loading'
  const savedMobile = mobileLoad?.userId === userId ? mobileLoad.saved : ''
  const mobileChanged =
    mobileState === 'loaded' && normalizeUserMobileInput(mobile) !== savedMobile
  const hasUnsavedChanges = mainChanged || mobileChanged

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
      setLoadFailure(null)
      try {
        const result = await callManageUser({ action: 'get', user_id: userId })
        if (!active) return
        const loadedUser = result.user as Profile
        setUser(loadedUser)
        setLoadedUserId(userId)
        setFullName(loadedUser.full_name)
        setEmail(loadedUser.email ?? '')
        setRole(loadedUser.role)
        const assignedCompanies = (loadedUser.assigned_companies ?? []).map(
          (company): CompanyOption => ({
            value: company.id,
            // Re-localized at render (see `companyOptions`).
            label: company.name_ar,
            name_ar: company.name_ar,
            name_en: company.name_en,
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
        if (active) setLoadFailure({ cause })
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => {
      active = false
    }
    // Neither the language nor `t` is a dependency: a language switch must
    // not reload the user and wipe unsaved edits. Names and messages are
    // localized at render instead.
  }, [callManageUser, reloadKey, userId])

  // The mobile number, read with the admin's own session from
  // `profile_contacts` (migration 0113: an admin reads every row, a user only
  // his own; no row means no number). Separate from the load above so its
  // retry does not reload the user and wipe unsaved edits.
  useEffect(() => {
    let active = true
    setMobileError(null)
    setMobileNotSaved(false)
    supabase
      .from('profile_contacts')
      .select('mobile_number')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (!active) return
        if (loadError) {
          setMobile('')
          setMobileLoad({ userId, state: 'failed', saved: '' })
          return
        }
        const stored =
          (data as Pick<ProfileContact, 'mobile_number'> | null)
            ?.mobile_number ?? ''
        setMobile(stored)
        setMobileLoad({ userId, state: 'loaded', saved: stored })
      })
    return () => {
      active = false
    }
  }, [mobileReloadKey, userId])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges])

  const loadCompanies = useCallback(
    async (search: string): Promise<CompanyOption[]> => {
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
        name_ar: company.name_ar,
        name_en: company.name_en,
      }))
    },
    [lang],
  )

  const loadAllCompanies = useCallback(async (): Promise<CompanyOption[]> => {
    const { data } = await supabase
      .from('companies')
      .select('id,name_ar,name_en')
      .order(lang === 'ar' ? 'name_ar' : 'name_en')
    return (data ?? []).map((company) => ({
      value: company.id,
      label: localizedName(lang, company.name_ar, company.name_en),
      name_ar: company.name_ar,
      name_en: company.name_en,
    }))
  }, [lang])

  // The selected companies with their labels in the active language.
  const companyOptions = useMemo(
    () =>
      companies.map((company) => ({
        ...company,
        label: localizedName(lang, company.name_ar, company.name_en),
      })),
    [companies, lang],
  )

  async function handleSave() {
    setError(null)
    setMobileError(null)
    setMobileNotSaved(false)
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
    // Checked before anything is written, so a mistyped number does not leave
    // the record half saved. The database function repeats the rule.
    const nextMobile = normalizeUserMobileInput(mobile)
    if (mobileChanged && !isValidUserMobile(nextMobile)) {
      setMobileError(t('userMobileInvalid'))
      return
    }
    setSaving(true)
    try {
      // 1. The record itself, through the Edge Function as before. Skipped
      //    only when the mobile number is the single change, so correcting a
      //    number does not rewrite the login details and company assignments.
      const saveMain = mainChanged || !mobileChanged
      if (saveMain) {
        const nextFullName = fullName.trim()
        const nextEmail = email.trim()
        try {
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
        } catch (cause) {
          // Nothing was written: the number is not attempted either, and
          // every edit stays in the form.
          setError(errorMessage(cause))
          return
        }
        setFullName(nextFullName)
        setEmail(nextEmail)
        setPassword('')
        // The summary above the form shows the saved record, so it follows
        // every field the update just wrote.
        setUser((current) =>
          current
            ? {
                ...current,
                full_name: nextFullName,
                email: nextEmail,
                role,
                assigned_companies:
                  role === 'supervisor'
                    ? companies.map((company) => ({
                        id: company.value,
                        name_ar: company.name_ar,
                        name_en: company.name_en,
                      }))
                    : [],
              }
            : current,
        )
        setSavedSnapshot(
          formSnapshot(nextFullName, nextEmail, '', role, companies),
        )
      }

      // 2. The mobile number, only when it changed. Its failure is reported
      //    on its own: what step 1 saved stays saved and is said to be saved.
      if (mobileChanged) {
        let message: string | null = null
        let failed = false
        try {
          const { error: mobileSaveError } = await supabase.rpc(
            'admin_set_user_mobile',
            { p_user_id: userId, p_mobile_number: nextMobile },
          )
          if (mobileSaveError) {
            failed = true
            message = mobileSaveError.message
          }
        } catch {
          failed = true
        }
        if (failed) {
          const code = userMobileErrorCode(message)
          setMobileError(
            code === 'invalid_mobile'
              ? t('userMobileInvalid')
              : code === 'admin_required'
                ? t('userPermissionError')
                : code === 'user_not_found'
                  ? t('userNotFound')
                  : t('userMobileSaveError'),
          )
          setMobileNotSaved(saveMain)
          return
        }
        setMobile(nextMobile)
        setMobileLoad({ userId, state: 'loaded', saved: nextMobile })
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleBack() {
    if (
      hasUnsavedChanges &&
      !(await confirm({
        title: t('unsavedChanges'),
        description: t('dialogDescUnsavedChanges'),
        tone: 'danger',
      }))
    )
      return
    onBack()
  }

  // Skeleton only while there is no user to show yet.
  if (loading && loadedUserId !== userId)
    return <UserDetailSkeleton label={t('loading')} />

  // A failed load is a page-level error, never an empty editable form.
  if (!user || loadedUserId !== userId)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackButton onClick={onBack} />
        <ErrorState
          description={errorMessage(loadFailure?.cause)}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      </div>
    )

  const roleLabel = (value: UserRole) =>
    roleOptions.find((option) => option.value === value)?.label ?? value

  // Saved values only (`user`), never the unsaved form state below.
  const accountItems: InfoGridItem[] = [
    {
      key: 'email',
      label: t('email'),
      value: user.email,
      dir: 'ltr',
    },
    { key: 'role', label: t('role'), value: roleLabel(user.role) },
    {
      key: 'mobile',
      label: t('mobileNumber'),
      // The saved number only. A failed read says so instead of showing the
      // "no value" dash, and a pending read is not an empty value either.
      ...(mobileState === 'loaded'
        ? { value: savedMobile || null, dir: 'ltr' as const }
        : mobileState === 'failed'
          ? {
              value: (
                <span className="font-normal text-danger">
                  {t('userMobileLoadError')}
                </span>
              ),
            }
          : {
              value: (
                <span className="flex h-6 items-center" aria-busy="true">
                  <Skeleton variant="text" className="h-4 w-28" />
                  <span className="sr-only">{t('loading')}</span>
                </span>
              ),
            }),
    },
    {
      key: 'createdAt',
      label: t('createdAt'),
      value: user.created_at ? formatDate(user.created_at) : null,
    },
    ...(user.role === 'supervisor'
      ? [
          {
            key: 'assignedCompanies',
            label: t('assignedCompanies'),
            value: user.assigned_companies?.length ? (
              <span className="flex flex-wrap gap-1.5">
                {user.assigned_companies.map((company) => (
                  <Badge key={company.id} tone="neutral">
                    {localizedName(lang, company.name_ar, company.name_en)}
                  </Badge>
                ))}
              </span>
            ) : null,
            // On the grid cell, so the badges get the whole row.
            cellClassName: 'sm:col-span-2',
          },
        ]
      : []),
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackButton onClick={handleBack} />
      <div className="card space-y-5">
        <DetailHeader
          as="h1"
          identifier={user.full_name || t('userDetails')}
          subtitle={t('userDetails')}
          badges={
            <>
              <Badge tone="neutral">{roleLabel(user.role)}</Badge>
              {user.must_change_password && (
                <Badge tone="warning">{t('mustChangePassword')}</Badge>
              )}
              {hasUnsavedChanges && (
                <Badge tone="warning">{t('unsavedData')}</Badge>
              )}
            </>
          }
        />
        {/* Two columns: the card is 768px wide at most, and three columns
            truncated the email address. */}
        <InfoGridSection
          title={t('userSectionAccount')}
          items={accountItems}
          columns={2}
        />
      </div>
      <div className="card space-y-4">
        <SectionHeader title={t('editUser')} />
        {error && <Alert type="error">{error}</Alert>}
        {mobileNotSaved && (
          <Notice tone="warning">{t('userSavedMobileFailed')}</Notice>
        )}
        {mobileState === 'failed' && (
          <Notice
            tone="danger"
            action={
              <Button
                size="sm"
                onClick={() => setMobileReloadKey((key) => key + 1)}
              >
                {t('retry')}
              </Button>
            }
          >
            {t('userMobileLoadError')}
          </Notice>
        )}
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
          <Field
            label={t('mobileNumber')}
            name="mobile_number"
            hint={t('userMobileHint')}
            error={mobileError}
          >
            {(control) => (
              <Input
                {...control}
                type="tel"
                inputMode="tel"
                dir="ltr"
                autoComplete="off"
                maxLength={24}
                // Editable only once the stored number is known, so a save
                // can never clear a number that merely failed to load.
                disabled={mobileState !== 'loaded'}
                value={mobile}
                onChange={(event) => {
                  setMobileError(null)
                  setMobile(event.target.value)
                }}
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
                value={companyOptions}
                // Every option comes from the loaders of this screen, which
                // always carry both names.
                onChange={(next) => setCompanies(next as CompanyOption[])}
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

// A form field: label line, gap and a control of the shared control height.
function FieldSkeleton() {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex h-5 items-center">
        <Skeleton variant="text" className="w-24" />
      </div>
      <Skeleton className="h-10 w-full md:h-9" />
    </div>
  )
}

/** First-load placeholder that mirrors the page: the same centred column,
 *  the account card (header plus the 2-column grid) and the edit card. */
function UserDetailSkeleton({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <Skeleton className="h-7 w-20" />

      <div className="card space-y-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-[26px] w-20 rounded-full" />
          </div>
          <div className="mt-0.5 flex h-[21px] items-center">
            <Skeleton variant="text" className="w-24" />
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex h-5 items-center">
            <Skeleton variant="text" className="w-24" />
          </div>
          <InfoGridSkeleton count={4} columns={2} />
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex h-5 items-center">
          <Skeleton variant="text" className="w-28" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldSkeleton />
          <FieldSkeleton />
          <FieldSkeleton />
          <FieldSkeleton />
          <FieldSkeleton />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Skeleton className="h-10 w-20 md:h-9" />
          <Skeleton className="h-10 w-20 md:h-9" />
        </div>
      </div>
    </div>
  )
}
