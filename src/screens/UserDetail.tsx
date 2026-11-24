import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { usePermissions } from '@/auth/PermissionsContext'
import { usersActions } from '@/lib/actionPermissions'
import { roleName } from '@/components/roles/roleRows'
import { useActiveRoles } from '@/components/roles/useActiveRoles'
import { foremanRoleKeys, isForemanRoleKey } from '@/lib/rolePermissionHolders'
import { PasswordInput } from '@/components/PasswordInput'
import { AssignmentLines } from '@/components/assignments/AssignmentLines'
import { UserAssignmentsDialog } from '@/components/assignments/UserAssignmentsDialog'
import { useI18n } from '@/i18n/I18nContext'
import { useTabTitle } from '@/components/TabTitle'
import { formatDate } from '@/lib/dateFormat'
import { supabase } from '@/lib/supabase'
import { callEdgeFunction, EdgeFunctionError } from '@/lib/edgeFunction'
import type { Profile, ProfileContact } from '@/lib/types'
import { normalizeUserMobileInput, userMobileErrorCode } from '@/lib/userMobile'
import { rolesRpcError } from '@/lib/rolesAdmin'
import {
  PROFILE_ASSIGNMENTS_SELECT,
  assignmentsFromRows,
  assignmentsLockOf,
  canManageAssignments,
  rowsFromAssignments,
  type AssignmentCompanyRow,
  type ProfileAssignmentRow,
} from '@/lib/foremanAssignments'
import {
  ASSIGN_ROLE_FIELD_CODES,
  assignedRoleFromEmbed,
  planRoleChange,
  type AssignedRole,
} from '@/lib/userRoleAssignment'
import {
  USER_EDIT_FIELD_ORDER,
  userEditServerFieldErrors,
  validateUserEditForm,
  type UserEditFormValues,
} from '@/lib/userForm'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  type FieldErrors,
} from '@/lib/formValidation'
import {
  PageTrailBar,
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
  type SelectOption as UiSelectOption,
} from '@/components/ui'
import { InfoGridSkeleton } from '@/components/ui/InfoGrid'

interface UserDetailProps {
  userId: string
  onBack: () => void
}

/** The record fields `manage-user` saves; the role is the assignment, which
 *  is tracked apart (`assignmentChanged`). The companies and projects are no
 *  longer edited here (migration 0212): «تعديل الاسناد» opens their dialog. */
function formSnapshot(fullName: string, email: string, password: string) {
  return JSON.stringify({ fullName, email, password })
}

export function UserDetail({ userId, onBack }: UserDetailProps) {
  const { t, lang } = useI18n()
  const [user, setUser] = useState<Profile | null>(null)
  // The tab reads «name · المستخدمون» (owner 2026-10-25).
  useTabTitle(user?.full_name)
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
  // The companies and projects the user is responsible for (0176), shown in
  // the account summary and edited in ONE dialog (migration 0212, owner
  // 2026-11-24: «مهمة منفصلة عن صفحة المستخدم»), the same dialog as
  // Settings › «اسناد الشركات والمشاريع». Read from `profile_assignments`.
  const [assignmentsLoad, setAssignmentsLoad] = useState<{
    userId: string
    state: 'loaded' | 'failed'
    rows: AssignmentCompanyRow[]
  } | null>(null)
  const [assignmentsReloadKey, setAssignmentsReloadKey] = useState(0)
  const [assignmentsOpen, setAssignmentsOpen] = useState(false)
  const [assignmentsSaved, setAssignmentsSaved] = useState(false)
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
  // wave 18: the messages of the checks run on save, under their fields.
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrors<UserEditFormValues>
  >({})
  const clearError = (field: keyof UserEditFormValues) =>
    setFieldErrors((current) => clearFieldErrors(current, [field]))
  const fieldError = (field: keyof UserEditFormValues) =>
    fieldErrors[field] ? t(fieldErrors[field]) : undefined
  // The rest of the record was saved but the number was not.
  const [mobileNotSaved, setMobileNotSaved] = useState(false)
  const { confirm, confirmDialog } = useConfirm()
  const { user: currentUser } = useAuth()
  // The user's ONE role, his `profile_roles` assignment (migration 0126;
  // since roles stage 4c-2, migration 0156, there is no other).
  const [systemRole, setSystemRole] = useState<{
    userId: string
    state: 'loaded' | 'failed'
    roleKey: string | null
    name: { name_ar: string; name_en: string } | null
  } | null>(null)
  const permissionState = usePermissions()
  const { reload: reloadPermissions } = permissionState
  // wave 24: saving the user follows `users.manage` (nobody while the
  // permissions load or after a failed load); the page gate and the
  // database (0127) require the same key.
  const canManageUsers = usersActions(permissionState).manage
  // 0211 (owner 2026-11-23): users.manage may be held by any role. Only the
  // admin (the one holder of the admin-only `settings.roles`) gives the admin
  // role or edits an admin's account; the database and the Edge Functions
  // refuse the rest.
  const callerIsAdmin = permissionState.can('settings.roles')
  const { roles: activeRoles } = useActiveRoles(true)
  // Roles stage 3 (owner 2026-10-27): «الشركات المسؤول عنها» belongs to every
  // role that records project movements (the admin aside). Until the roles
  // are read, or when they cannot be, see `companiesFor`.
  const [foremanKeys, setForemanKeys] = useState<ReadonlySet<string> | null>(
    null,
  )
  useEffect(() => {
    let active = true
    foremanRoleKeys(supabase).then(
      (keys) => {
        if (active) setForemanKeys(new Set(keys))
      },
      () => {
        if (active) setForemanKeys(null)
      },
    )
    return () => {
      active = false
    }
  }, [])
  // The role chosen in the form (`roles.key`; '' = no assignment yet).
  const [assignedRoleKey, setAssignedRoleKey] = useState('')
  const systemRoleLoaded =
    systemRole?.userId === userId && systemRole.state === 'loaded'
  const savedAssignedKey = systemRoleLoaded ? (systemRole.roleKey ?? '') : ''
  // An admin's account is read-only for a user manager who is not the admin.
  const adminTargetLocked = !callerIsAdmin && savedAssignedKey === 'admin'
  const canSaveUser = canManageUsers && !adminTargetLocked
  const assignmentChanged =
    systemRoleLoaded &&
    assignedRoleKey !== '' &&
    assignedRoleKey !== savedAssignedKey

  const currentSnapshot = useMemo(
    () => formSnapshot(fullName, email, password),
    [email, fullName, password],
  )
  const mainChanged =
    savedSnapshot !== null && currentSnapshot !== savedSnapshot
  // Known only once the number of THIS user was read.
  const mobileState =
    mobileLoad?.userId === userId ? mobileLoad.state : 'loading'
  const savedMobile = mobileLoad?.userId === userId ? mobileLoad.saved : ''
  const mobileChanged =
    mobileState === 'loaded' && normalizeUserMobileInput(mobile) !== savedMobile
  const assignmentsState =
    assignmentsLoad?.userId === userId ? assignmentsLoad.state : 'loading'
  const assignmentRows =
    assignmentsLoad?.userId === userId ? assignmentsLoad.rows : []
  const hasUnsavedChanges = mainChanged || mobileChanged || assignmentChanged

  // The steps a save runs for the role (`planRoleChange`): the assignment
  // through `admin_assign_profile_role` when it changed.
  const rolePlan = useMemo(
    () =>
      systemRoleLoaded && assignedRoleKey
        ? planRoleChange({
            currentAssigned: systemRole.roleKey,
            newRoleKey: assignedRoleKey,
          })
        : [],
    [assignedRoleKey, systemRole, systemRoleLoaded],
  )
  // Whether the summary shows «الشركات والمشاريع»: for a role that records
  // project movements (by the permission once the foreman roles and the
  // user's assignment are read, else the original foreman role), and for
  // any user who already carries assignments.
  const companiesFor = (roleKey: string | null | undefined) =>
    foremanKeys && systemRoleLoaded
      ? isForemanRoleKey(roleKey, foremanKeys)
      : roleKey === 'supervisor'
  const savedCompaniesApply = user
    ? companiesFor(savedAssignedKey) || assignmentRows.length > 0
    : false
  // 0212: users.manage or users.assignments edits the assignments; a caller
  // who is not the admin never his own account nor an admin's (the database
  // refuses them too).
  const assignmentsLock = assignmentsLockOf({
    callerIsAdmin,
    callerId: currentUser?.id,
    targetId: userId,
    targetIsAdmin: savedAssignedKey === 'admin',
  })
  const canEditAssignments =
    canManageAssignments(permissionState.can) &&
    systemRoleLoaded &&
    assignmentsState === 'loaded' &&
    !assignmentsLock

  // The active roles; the current assignment stays visible (disabled) when
  // it is inactive or unknown, as on the roles page.
  const assignedRoleOptions = useMemo(() => {
    const options: UiSelectOption[] = (activeRoles ?? [])
      .filter((candidate) => callerIsAdmin || candidate.key !== 'admin')
      .map((candidate) => ({
        value: candidate.key,
        label: roleName(lang, candidate),
      }))
    if (
      savedAssignedKey &&
      !options.some((option) => option.value === savedAssignedKey)
    )
      options.unshift({
        value: savedAssignedKey,
        label: systemRole?.name
          ? roleName(lang, systemRole.name)
          : t('roleUsersUnknownRole'),
        disabled: true,
      })
    return options
  }, [activeRoles, callerIsAdmin, lang, savedAssignedKey, systemRole, t])

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
      if (cause.serverCode === 'admin_role_admin_only')
        return t('rolesErrAdminRoleAdminOnly')
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
      setFieldErrors({})
      try {
        const result = await callManageUser({ action: 'get', user_id: userId })
        if (!active) return
        const loadedUser = result.user as Profile
        setUser(loadedUser)
        setLoadedUserId(userId)
        setFullName(loadedUser.full_name)
        setEmail(loadedUser.email ?? '')
        setSavedSnapshot(
          formSnapshot(loadedUser.full_name, loadedUser.email ?? '', ''),
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
    let active = true
    supabase
      .from('profile_assignments')
      .select(PROFILE_ASSIGNMENTS_SELECT)
      .eq('profile_id', userId)
      .order('company_name_ar')
      .then(({ data, error: loadError }) => {
        if (!active) return
        if (loadError) {
          setAssignmentsLoad({ userId, state: 'failed', rows: [] })
          return
        }
        setAssignmentsLoad({
          userId,
          state: 'loaded',
          rows: (data ?? []) as ProfileAssignmentRow[],
        })
      })
    return () => {
      active = false
    }
  }, [assignmentsReloadKey, userId])

  useEffect(() => {
    let active = true
    supabase
      .from('profile_roles')
      .select('role_key,roles(name_ar,name_en)')
      .eq('profile_id', userId)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (!active) return
        if (loadError) {
          setSystemRole({ userId, state: 'failed', roleKey: null, name: null })
          return
        }
        const assigned = assignedRoleFromEmbed(data)
        setSystemRole({
          userId,
          state: 'loaded',
          roleKey: assigned?.key ?? null,
          name: assigned
            ? { name_ar: assigned.name_ar, name_en: assigned.name_en }
            : null,
        })
        setAssignedRoleKey(assigned?.key ?? '')
      })
    return () => {
      active = false
    }
  }, [userId])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges])

  async function handleSave() {
    setError(null)
    setMobileError(null)
    setMobileNotSaved(false)
    // Every field is checked before anything is written (so a mistyped number
    // does not leave the record half saved), and each message goes under its
    // field. The Edge Function and the database function repeat the rules.
    const invalid = validateUserEditForm({
      full_name: fullName,
      email,
      role: assignedRoleKey,
      password,
      mobile_number: mobileChanged ? mobile : '',
    })
    if (hasErrors(invalid)) {
      setFieldErrors(invalid)
      focusFirstError(invalid, USER_EDIT_FIELD_ORDER)
      return
    }
    setFieldErrors({})
    const nextMobile = normalizeUserMobileInput(mobile)
    // The role step planned above (the assignment, when it changed).
    const assignStep = rolePlan.find((step) => step.kind === 'assign')
    setSaving(true)
    try {
      // 1. The record itself, through the Edge Function as before. Skipped
      //    only when the mobile number and/or the assignment alone changed,
      //    so correcting a number (or assigning a role) does not rewrite the
      //    login details.
      const saveMain = mainChanged || (!mobileChanged && !assignStep)
      if (saveMain) {
        const nextFullName = fullName.trim()
        const nextEmail = email.trim()
        // 0212: the companies are edited in their own dialog (here or in
        // Settings), never by this form. manage-user still replaces the
        // links with the list it receives, so it gets the companies stored
        // RIGHT NOW: it then changes none (it writes only the ones that
        // differ). A failed read saves nothing, never an empty list.
        const { data: storedLinks, error: linksError } = await supabase
          .from('profile_companies')
          .select('company_id')
          .eq('profile_id', userId)
        if (linksError) {
          setError(t('userAssignmentsCompaniesLoadError'))
          return
        }
        try {
          await callManageUser({
            action: 'update',
            user_id: userId,
            full_name: nextFullName,
            email: nextEmail,
            password,
            company_ids: (storedLinks ?? []).map((link) =>
              String(link.company_id),
            ),
          })
        } catch (cause) {
          // Nothing was written: the number is not attempted either, and
          // every edit stays in the form. A refusal about the role goes
          // under the role; anything else is a form-level message.
          const attributed =
            cause instanceof EdgeFunctionError
              ? userEditServerFieldErrors(cause.serverCode)
              : null
          if (attributed) {
            setFieldErrors(attributed)
            focusFirstError(attributed, USER_EDIT_FIELD_ORDER)
          } else setError(errorMessage(cause))
          return
        }
        setFullName(nextFullName)
        setEmail(nextEmail)
        setPassword('')
        // The summary above the form shows the saved record, so it follows
        // every field the update just wrote.
        setUser((current) =>
          current
            ? { ...current, full_name: nextFullName, email: nextEmail }
            : current,
        )
        setSavedSnapshot(formSnapshot(nextFullName, nextEmail, ''))
      }

      // 1b. The assignment, when the plan needs it. The record above is
      //     saved and said to be saved; a refusal goes under the role (the
      //     0126/0153 codes) or, unknown, as a form-level message.
      if (assignStep) {
        let failure: {
          message?: string | null
          details?: string | null
        } | null = null
        try {
          const { error: assignError } = await supabase.rpc(
            'admin_assign_profile_role',
            { p_profile_id: userId, p_role_key: assignStep.roleKey },
          )
          if (assignError) failure = assignError
        } catch {
          failure = {}
        }
        if (failure) {
          const mapped = rolesRpcError(failure, 'userRoleAssignFailed')
          if (mapped.code && ASSIGN_ROLE_FIELD_CODES.has(mapped.code)) {
            const attributed: FieldErrors<UserEditFormValues> = {
              role: mapped.messageKey,
            }
            setFieldErrors(attributed)
            focusFirstError(attributed, USER_EDIT_FIELD_ORDER)
          } else setError(t(mapped.messageKey))
          return
        }
        applyAssignment(assignStep.roleKey)
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

  /** The assignment now stored, as the page shows it (names from the active
   *  roles); the header follows when it is the signed-in admin's own. */
  function applyAssignment(roleKey: string) {
    const stored: AssignedRole | undefined = activeRoles?.find(
      (candidate) => candidate.key === roleKey,
    )
    setSystemRole({
      userId,
      state: 'loaded',
      roleKey,
      name: stored
        ? { name_ar: stored.name_ar, name_en: stored.name_en }
        : { name_ar: roleKey, name_en: roleKey },
    })
    setAssignedRoleKey(roleKey)
    if (currentUser?.id === userId) void reloadPermissions()
  }

  // Leaving with unsaved changes asks first: the back button and the
  // trail's crumbs alike.
  async function confirmLeave() {
    return (
      !hasUnsavedChanges ||
      confirm({
        title: t('unsavedChanges'),
        description: t('dialogDescUnsavedChanges'),
        tone: 'danger',
      })
    )
  }

  async function handleBack() {
    if (await confirmLeave()) onBack()
  }

  // Skeleton only while there is no user to show yet.
  if (loading && loadedUserId !== userId)
    return <UserDetailSkeleton label={t('loading')} />

  // A failed load is a page-level error, never an empty editable form.
  if (!user || loadedUserId !== userId)
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageTrailBar onBack={onBack} />
        <ErrorState
          description={errorMessage(loadFailure?.cause)}
          onRetry={() => setReloadKey((key) => key + 1)}
        />
      </div>
    )

  // The saved assignment's name; «بدون دور» for a user without one; nothing
  // until it is read (or when it could not be read).
  const savedRoleLabel = !systemRoleLoaded
    ? null
    : systemRole.name
      ? roleName(lang, systemRole.name)
      : t('roleUsersNoRole')

  // Saved values only (`user`), never the unsaved form state below.
  const accountItems: InfoGridItem[] = [
    {
      key: 'email',
      label: t('email'),
      value: user.email,
      dir: 'ltr',
    },
    {
      key: 'role',
      label: t('role'),
      value:
        systemRole?.userId === userId && systemRole.state === 'failed' ? (
          <span className="font-normal text-danger">
            {t('userNewSystemRoleLoadError')}
          </span>
        ) : (
          savedRoleLabel
        ),
    },
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
    // 0212: the companies and projects, one line per company, with «تعديل
    // الاسناد» for whoever may edit them (the approved design).
    ...(savedCompaniesApply || assignmentsState === 'failed'
      ? [
          {
            key: 'assignments',
            label: t('userAssignmentsColumn'),
            value:
              assignmentsState === 'failed' ? (
                <span className="inline-flex flex-wrap items-center gap-2 font-normal text-danger">
                  {t('userAssignmentsLoadError')}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAssignmentsReloadKey((key) => key + 1)}
                  >
                    {t('retry')}
                  </Button>
                </span>
              ) : assignmentsState === 'loading' ? (
                <span className="flex h-6 items-center" aria-busy="true">
                  <Skeleton variant="text" className="h-4 w-40" />
                  <span className="sr-only">{t('loading')}</span>
                </span>
              ) : (
                <span className="flex flex-col items-start gap-2 font-normal">
                  <AssignmentLines rows={assignmentRows} />
                  {canEditAssignments && (
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<Pencil size={14} aria-hidden="true" />}
                      onClick={() => setAssignmentsOpen(true)}
                    >
                      {t('userAssignmentsEdit')}
                    </Button>
                  )}
                </span>
              ),
            // On the grid cell, so the lines get the whole row.
            cellClassName: 'sm:col-span-2',
          },
        ]
      : []),
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTrailBar onBack={handleBack} confirmLeave={confirmLeave} />
      <div className="card space-y-5">
        <DetailHeader
          as="h1"
          identifier={user.full_name || t('userDetails')}
          subtitle={t('userDetails')}
          badges={
            <>
              {savedRoleLabel && <Badge tone="neutral">{savedRoleLabel}</Badge>}
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
        {assignmentsSaved && (
          <Notice tone="success" size="compact">
            {t('userAssignmentsSaved').replace('{name}', user.full_name)}
          </Notice>
        )}
      </div>
      <div className="card space-y-4">
        <SectionHeader title={t('editUser')} />
        {adminTargetLocked && canManageUsers && (
          <Notice tone="info">{t('userAdminTargetLocked')}</Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
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
          <Field
            label={t('fullName')}
            name="full_name"
            required
            error={fieldError('full_name')}
          >
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                value={fullName}
                onChange={(event) => {
                  clearError('full_name')
                  setFullName(event.target.value)
                }}
              />
            )}
          </Field>
          <Field
            label={t('email')}
            name="email"
            required
            error={fieldError('email')}
          >
            {(control) => (
              <Input
                {...control}
                type="email"
                dir="ltr"
                autoComplete="off"
                value={email}
                onChange={(event) => {
                  clearError('email')
                  setEmail(event.target.value)
                }}
              />
            )}
          </Field>
          <Field
            label={t('role')}
            name="role"
            hint={t('userRoleManagedInSettings')}
            error={fieldError('role')}
          >
            {(control) => (
              // The `profile_roles` assignment, the user's one role.
              <Select
                {...control}
                value={assignedRoleKey || undefined}
                placeholder={t('roleUsersNoRole')}
                disabled={!systemRoleLoaded || !activeRoles}
                onValueChange={(value) => {
                  clearError('role')
                  setAssignedRoleKey(value)
                }}
                options={assignedRoleOptions}
              />
            )}
          </Field>
          <Field
            label={t('temporaryPassword')}
            name="password"
            hint={t('temporaryPasswordHelp')}
            error={fieldError('password')}
          >
            {(control) => (
              <PasswordInput
                {...control}
                dir="ltr"
                autoComplete="new-password"
                value={password}
                onChange={(event) => {
                  clearError('password')
                  setPassword(event.target.value)
                }}
              />
            )}
          </Field>
          <Field
            label={t('mobileNumber')}
            name="mobile_number"
            hint={t('userMobileHint')}
            error={fieldError('mobile_number') ?? mobileError}
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
                  clearError('mobile_number')
                  setMobile(event.target.value)
                }}
              />
            )}
          </Field>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={handleBack}>
            {t('cancel')}
          </Button>
          {canSaveUser && (
            <Button
              variant="primary"
              loading={saving}
              // Nothing to save until something changed (owner 2026-11-07:
              // a save with no change rewrote the company links).
              disabled={!hasUnsavedChanges}
              onClick={handleSave}
            >
              {t('save')}
            </Button>
          )}
        </div>
      </div>
      {canEditAssignments && (
        <UserAssignmentsDialog
          open={assignmentsOpen}
          onOpenChange={setAssignmentsOpen}
          userId={userId}
          userName={user.full_name}
          subtitle={savedRoleLabel}
          initial={assignmentsFromRows(assignmentRows, lang)}
          onSaved={(saved) => {
            setAssignmentsLoad({
              userId,
              state: 'loaded',
              rows: rowsFromAssignments(saved),
            })
            setAssignmentsOpen(false)
            setAssignmentsSaved(true)
          }}
        />
      )}
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
