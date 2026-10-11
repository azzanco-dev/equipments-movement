'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/auth/AuthContext'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import { rolesPageAccess } from '@/lib/permissions'
import { rolesSystemEnabledFromValue } from '@/lib/rolesAdmin'
import type { Permission } from '@/lib/types'
import { fetchProfileNames } from '@/components/details/profileNames'
import {
  ErrorState,
  Notice,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useConfirm,
} from '@/components/ui'
import { RolesSystemBanner, type RolesSystemFlag } from './RolesSystemBanner'
import { RolesListSection } from './RolesListSection'
import { RoleAssignmentsSection } from './RoleAssignmentsSection'
import { RolesActivationSection } from './RolesActivationSection'
import { RoleChangesLog } from './RoleChangesLog'
import { sortRoles, type RoleRow } from './roleRows'

type RolesTab = 'roles' | 'users' | 'activation' | 'audit'
const TABS: readonly RolesTab[] = ['roles', 'users', 'activation', 'audit']

type RoleQueryRow = Omit<RoleRow, 'user_count' | 'permission_count'> & {
  profile_roles: Array<{ count: number }> | null
  role_permissions: Array<{ count: number }> | null
}

/**
 * wave 22B — Settings › «الادوار والصلاحيات» (migration 0126).
 *
 * Admin only, fail closed twice: App.tsx renders it inside the admin branch
 * (after the `profile.role !== 'admin'` check), and the page itself needs a
 * legacy admin who also holds `settings.roles` (`rolesPageAccess`). Every
 * write goes through the admin-only SECURITY DEFINER functions of 0126.
 *
 * The roles system stays INACTIVE until the owner presses the activation
 * button in the «التفعيل» tab; nothing on this page enables it on its own.
 */
export function RolesSettings() {
  const { t } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { profile } = useAuth()
  const permissions = usePermissions()
  const access = rolesPageAccess(
    profile?.role,
    permissions.status,
    permissions.permissions,
  )
  const requestedTab = searchParams.get('tab')
  const tab: RolesTab = TABS.includes(requestedTab as RolesTab)
    ? (requestedTab as RolesTab)
    : 'roles'

  const [flag, setFlag] = useState<RolesSystemFlag | null>(null)
  const [flagError, setFlagError] = useState(false)
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [catalogue, setCatalogue] = useState<Permission[]>([])
  const [baseLoading, setBaseLoading] = useState(true)
  const [baseError, setBaseError] = useState(false)
  // Bumped after every change so the counts, offenders, preview and audit
  // are read again.
  const [revision, setRevision] = useState(0)
  const [editorDirty, setEditorDirty] = useState(false)
  const [usersSearchSeed, setUsersSearchSeed] = useState<{
    term: string
    seq: number
  } | null>(null)
  const { confirm, confirmDialog } = useConfirm()

  const loadFlag = useCallback(async () => {
    setFlagError(false)
    const { data, error } = await supabase
      .from('app_settings')
      .select('value,updated_at,updated_by')
      .eq('key', 'roles_system')
      .maybeSingle()
    if (error) {
      setFlagError(true)
      return
    }
    const row = data as {
      value: unknown
      updated_at: string
      updated_by: string | null
    } | null
    const names = await fetchProfileNames(supabase, [row?.updated_by])
    setFlag({
      enabled: rolesSystemEnabledFromValue(row?.value),
      updatedAt: row?.updated_at ?? null,
      updatedByName: row?.updated_by
        ? (names.names.get(row.updated_by) ?? null)
        : null,
    })
  }, [])

  const loadBase = useCallback(async () => {
    setBaseError(false)
    const [rolesResult, catalogueResult] = await Promise.all([
      supabase
        .from('roles')
        .select(
          'key,name_ar,name_en,description_ar,description_en,is_system,is_active,created_at,created_by,updated_at,updated_by,profile_roles(count),role_permissions(count)',
        ),
      supabase
        .from('permissions')
        .select(
          'key,group_key,name_ar,name_en,description_ar,description_en,scoped,scopes,requires,admin_only,enforced_in,sort',
        )
        .order('sort'),
    ])
    if (rolesResult.error || catalogueResult.error) {
      setBaseError(true)
      setBaseLoading(false)
      return
    }
    const rows = ((rolesResult.data as RoleQueryRow[] | null) ?? []).map(
      ({ profile_roles, role_permissions, ...role }): RoleRow => ({
        ...role,
        user_count: profile_roles?.[0]?.count ?? 0,
        permission_count: role_permissions?.[0]?.count ?? 0,
      }),
    )
    setRoles(sortRoles(rows))
    setCatalogue((catalogueResult.data as Permission[] | null) ?? [])
    setBaseLoading(false)
  }, [])

  useEffect(() => {
    if (access !== 'allowed') return
    void loadFlag()
  }, [access, loadFlag, revision])

  useEffect(() => {
    if (access !== 'allowed') return
    void loadBase()
  }, [access, loadBase, revision])

  // Unsaved permission edits: warn before leaving the browser tab.
  useEffect(() => {
    if (!editorDirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [editorDirty])

  /** Resolves true when there is nothing unsaved or the admin discards it. */
  const confirmDiscard = useCallback(async () => {
    if (!editorDirty) return true
    const discard = await confirm({
      title: t('unsavedChanges'),
      description: t('dialogDescUnsavedChanges'),
      tone: 'danger',
    })
    if (discard) setEditorDirty(false)
    return discard
  }, [confirm, editorDirty, t])

  const changeTab = async (next: string) => {
    if (next === tab || !(await confirmDiscard())) return
    const query = new URLSearchParams(searchParams.toString())
    if (next === 'roles') query.delete('tab')
    else query.set('tab', next)
    const search = query.toString()
    router.replace(search ? `${pathname}?${search}` : pathname)
  }

  const goBack = async () => {
    if (await confirmDiscard()) router.push('/settings')
  }

  /** After any write: re-read everything and the caller's own permissions. */
  const afterChange = useCallback(() => {
    setRevision((value) => value + 1)
    void permissions.reload()
  }, [permissions])

  const fixOffender = (fullName: string) => {
    setUsersSearchSeed((current) => ({
      term: fullName,
      seq: (current?.seq ?? 0) + 1,
    }))
    void changeTab('users')
  }

  const header = (
    <PageHeader
      title={t('rolesSettingsTitle')}
      description={t('rolesSettingsDesc')}
      onBack={() => void goBack()}
      backLabel={t('backToSettings')}
    />
  )

  const activeRoles = useMemo(
    () => roles.filter((role) => role.is_active),
    [roles],
  )

  if (access === 'loading')
    return (
      <div className="space-y-4" aria-busy="true">
        {header}
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )

  if (access === 'error')
    return (
      <div className="space-y-4">
        {header}
        <ErrorState
          description={t('rolesAccessLoadError')}
          onRetry={() => void permissions.reload()}
        />
      </div>
    )

  if (access !== 'allowed')
    return (
      <div className="space-y-4">
        {header}
        <Notice tone="warning">{t('rolesAccessDenied')}</Notice>
      </div>
    )

  return (
    <div className="space-y-4">
      {header}
      <RolesSystemBanner
        flag={flag}
        failed={flagError}
        onRetry={() => void loadFlag()}
      />
      {baseError ? (
        <ErrorState
          description={t('rolesLoadError')}
          onRetry={() => {
            setBaseLoading(true)
            void loadBase()
          }}
        />
      ) : (
        <Tabs value={tab} onValueChange={(next) => void changeTab(next)}>
          <TabsList>
            <TabsTrigger value="roles">{t('rolesTabRoles')}</TabsTrigger>
            <TabsTrigger value="users">{t('rolesTabUsers')}</TabsTrigger>
            <TabsTrigger value="activation">
              {t('rolesTabActivation')}
            </TabsTrigger>
            <TabsTrigger value="audit">{t('rolesTabAudit')}</TabsTrigger>
          </TabsList>
          <TabsContent value="roles">
            <RolesListSection
              roles={roles}
              catalogue={catalogue}
              loading={baseLoading}
              onChanged={afterChange}
              onEditorDirtyChange={setEditorDirty}
              confirmDiscard={confirmDiscard}
            />
          </TabsContent>
          <TabsContent value="users">
            <RoleAssignmentsSection
              roles={roles}
              activeRoles={activeRoles}
              loadingRoles={baseLoading}
              searchSeed={usersSearchSeed}
              revision={revision}
              onChanged={afterChange}
            />
          </TabsContent>
          <TabsContent value="activation">
            <RolesActivationSection
              flag={flag}
              roles={roles}
              catalogue={catalogue}
              revision={revision}
              onFixOffender={fixOffender}
              onChanged={afterChange}
            />
          </TabsContent>
          <TabsContent value="audit">
            <RoleChangesLog
              roles={roles}
              catalogue={catalogue}
              revision={revision}
            />
          </TabsContent>
        </Tabs>
      )}
      {confirmDialog}
    </div>
  )
}
