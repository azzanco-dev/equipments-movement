'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Settings2 } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import { rolesPageAccess } from '@/lib/permissions'
import { rolesRpcError, rolesSystemEnabledFromValue } from '@/lib/rolesAdmin'
import type { Permission } from '@/lib/types'
import { fetchProfileNames } from '@/components/details/profileNames'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  Skeleton,
  cn,
  useConfirm,
} from '@/components/ui'
import {
  roleDescription,
  roleName,
  sortRoles,
  type RoleRow,
  type RolesSystemFlag,
} from './roleRows'
import {
  ROLE_PANEL_TABS,
  RolePanel,
  RolesList,
  type RoleItem,
  type RolePanelTab,
} from './ui'
import { RolePermissionsTab } from './RolePermissionsTab'
import { RoleUsersTab } from './RoleUsersTab'
import { RoleChangesTab } from './RoleChangesTab'
import { RoleFormContainer } from './RoleFormContainer'
import { SystemSettingsContainer } from './SystemSettingsContainer'

type RoleQueryRow = Omit<RoleRow, 'user_count' | 'permission_count'> & {
  profile_roles: Array<{ count: number }> | null
  role_permissions: Array<{ count: number }> | null
}

/**
 * Settings › «الادوار والصلاحيات» (migration 0126), on the layout the owner
 * approved on /ui-kit (2026-10-14): the roles list at the start side, the
 * selected role's panel (permissions, users, change log) beside it, and
 * «اعدادات النظام» for the activation flow and the full log. The URL keeps the
 * selected role (`?role=`) and tab (`?tab=`) so Back works.
 *
 * Admin only, fail closed twice: App.tsx renders it behind its page gate and
 * the page itself needs a legacy admin who also holds `settings.roles`
 * (`rolesPageAccess`). Every write goes through the admin-only SECURITY
 * DEFINER functions of 0126; the roles system stays INACTIVE until the admin
 * presses the activation button in «اعدادات النظام» — nothing on this page
 * enables it on its own.
 */
export function RolesSettings() {
  const { t, lang } = useI18n()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const permissions = usePermissions()
  const access = rolesPageAccess(permissions.status, permissions.permissions)
  const roleParam = searchParams.get('role')
  const tabParam = searchParams.get('tab')
  const tab: RolePanelTab = ROLE_PANEL_TABS.includes(tabParam as RolePanelTab)
    ? (tabParam as RolePanelTab)
    : 'permissions'

  const [flag, setFlag] = useState<RolesSystemFlag | null>(null)
  const [flagError, setFlagError] = useState(false)
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [catalogue, setCatalogue] = useState<Permission[]>([])
  const [baseLoading, setBaseLoading] = useState(true)
  const [baseError, setBaseError] = useState(false)
  // Bumped after every write so the counts, the tabs, the offenders, the
  // preview and the audit are read again.
  const [revision, setRevision] = useState(0)
  const [editorDirty, setEditorDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{
    tone: 'success' | 'danger'
    text: string
  } | null>(null)
  const [roleDialog, setRoleDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; role: RoleRow } | null
  >(null)
  const [systemOpen, setSystemOpen] = useState(false)
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

  /** After any write: re-read everything and the caller's own permissions. */
  const afterChange = useCallback(() => {
    setRevision((value) => value + 1)
    void permissions.reload()
  }, [permissions])

  const navigate = (
    next: { role?: string | null; tab?: RolePanelTab | null },
    mode: 'push' | 'replace',
  ) => {
    const query = new URLSearchParams(searchParams.toString())
    if (next.role !== undefined) {
      if (next.role) query.set('role', next.role)
      else query.delete('role')
    }
    if (next.tab !== undefined) {
      if (next.tab && next.tab !== 'permissions') query.set('tab', next.tab)
      else query.delete('tab')
    }
    const search = query.toString()
    const url = search ? `${pathname}?${search}` : pathname
    if (mode === 'push') router.push(url)
    else router.replace(url)
  }

  const roleItems: RoleItem[] = useMemo(
    () =>
      roles.map((role) => ({
        key: role.key,
        name: roleName(lang, role),
        nameEn: lang === 'ar' ? role.name_en : role.name_ar,
        description: roleDescription(lang, role),
        isSystem: role.is_system,
        isActive: role.is_active,
        userCount: role.user_count,
      })),
    [lang, roles],
  )

  const selected =
    roles.find((role) => role.key === roleParam) ?? roles[0] ?? null
  const selectedItem = selected
    ? (roleItems.find((item) => item.key === selected.key) ?? null)
    : null
  // Below lg the list and the panel alternate: the panel shows once a role
  // is in the URL, the list otherwise (Back returns to the list).
  const mobileView: 'list' | 'panel' = roleParam ? 'panel' : 'list'

  const selectRole = async (key: string) => {
    if (key === roleParam) return
    if (!(await confirmDiscard())) return
    navigate({ role: key, tab: null }, 'push')
  }

  const changeTab = async (next: RolePanelTab) => {
    if (next === tab || !(await confirmDiscard())) return
    navigate({ tab: next }, 'replace')
  }

  const goBack = async () => {
    if (await confirmDiscard()) router.push('/settings')
  }

  const toggleActive = async (role: RoleRow) => {
    if (role.is_system) return
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('admin_upsert_role', {
        p_key: role.key,
        p_name_ar: role.name_ar,
        p_name_en: role.name_en,
        p_description_ar: role.description_ar,
        p_description_en: role.description_en,
        p_is_active: !role.is_active,
      })
      if (error) {
        setMessage({
          tone: 'danger',
          text: t(rolesRpcError(error, 'roleSaveError').messageKey),
        })
        return
      }
      setMessage({ tone: 'success', text: t('rolesToggleActiveDone') })
      afterChange()
    } catch {
      setMessage({ tone: 'danger', text: t('roleSaveError') })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (role: RoleRow) => {
    if (role.is_system || role.user_count > 0) return
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('admin_delete_role', {
        p_role_key: role.key,
      })
      if (error) {
        setMessage({
          tone: 'danger',
          text: t(rolesRpcError(error).messageKey),
        })
        return
      }
      setEditorDirty(false)
      setMessage({ tone: 'success', text: t('rolesDeleted') })
      navigate({ role: null, tab: null }, 'replace')
      afterChange()
    } catch {
      setMessage({ tone: 'danger', text: t('rolesErrGeneric') })
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <PageHeader
      title={t('rolesSettingsTitle')}
      description={t('rolesSettingsDesc')}
      onBack={() => void goBack()}
      backLabel={t('backToSettings')}
      actions={
        access === 'allowed' ? (
          <Button
            variant="outline"
            icon={<Settings2 size={16} aria-hidden="true" />}
            onClick={() => setSystemOpen(true)}
          >
            {t('rolesPageSystemSettings')}
            {flag && (
              <Badge size="sm" tone={flag.enabled ? 'success' : 'neutral'}>
                {flag.enabled
                  ? t('rolesSystemStatusActive')
                  : t('rolesSystemStatusInactive')}
              </Badge>
            )}
          </Button>
        ) : undefined
      }
    />
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
      {flagError && (
        <Notice
          tone="danger"
          action={
            <Button size="sm" onClick={() => void loadFlag()}>
              {t('retry')}
            </Button>
          }
        >
          {t('rolesSystemStatusLoadError')}
        </Notice>
      )}
      {message && (
        <Notice tone={message.tone} onDismiss={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}

      <div className="overflow-hidden rounded-xl border bg-bg">
        <div className="lg:grid lg:grid-cols-[300px_minmax(0,1fr)]">
          <div
            className={cn(
              'border-b lg:border-b-0 lg:border-e',
              mobileView === 'panel' && 'hidden lg:block',
            )}
          >
            <RolesList
              roles={roleItems}
              selectedKey={selected?.key ?? null}
              loading={baseLoading}
              error={baseError}
              onRetry={() => {
                setBaseLoading(true)
                void loadBase()
              }}
              onSelect={(key) => void selectRole(key)}
              onAdd={() => setRoleDialog({ mode: 'create' })}
            />
          </div>
          <div
            className={cn(
              'min-w-0',
              mobileView === 'list' && 'hidden lg:block',
            )}
          >
            {baseError ? (
              <ErrorState
                className="m-4"
                description={t('rolesLoadError')}
                onRetry={() => {
                  setBaseLoading(true)
                  void loadBase()
                }}
              />
            ) : baseLoading ? (
              <div className="space-y-3 p-4" aria-busy="true">
                <Skeleton className="h-8 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : selected && selectedItem ? (
              <RolePanel
                key={selected.key}
                role={selectedItem}
                usersCount={selected.user_count}
                tab={tab}
                onTabChange={(next) => void changeTab(next)}
                onBack={() => navigate({ role: null, tab: null }, 'push')}
                onEdit={() => setRoleDialog({ mode: 'edit', role: selected })}
                onToggleActive={() => void toggleActive(selected)}
                onDelete={() => void remove(selected)}
                busy={busy}
              >
                {tab === 'permissions' && (
                  <RolePermissionsTab
                    roleKey={selected.key}
                    catalogue={catalogue}
                    onSaved={afterChange}
                    onDirtyChange={setEditorDirty}
                  />
                )}
                {tab === 'users' && (
                  <RoleUsersTab
                    role={selected}
                    roles={roles}
                    revision={revision}
                    onChanged={afterChange}
                  />
                )}
                {tab === 'changes' && (
                  <RoleChangesTab
                    roleKey={selected.key}
                    roles={roles}
                    catalogue={catalogue}
                    revision={revision}
                  />
                )}
              </RolePanel>
            ) : (
              <EmptyState title={t('rolesPanelPick')} className="m-4" />
            )}
          </div>
        </div>
      </div>

      <RoleFormContainer
        open={roleDialog !== null}
        editing={roleDialog?.mode === 'edit' ? roleDialog.role : null}
        roleItems={roleItems}
        catalogue={catalogue}
        onOpenChange={(open) => {
          if (!open) setRoleDialog(null)
        }}
        onChanged={afterChange}
        onSaved={(roleKey, created) => {
          setRoleDialog(null)
          setMessage({ tone: 'success', text: t('rolesSaved') })
          if (created) navigate({ role: roleKey, tab: null }, 'push')
        }}
      />
      <SystemSettingsContainer
        open={systemOpen}
        onOpenChange={setSystemOpen}
        flag={flag}
        flagError={flagError}
        onRetryFlag={() => void loadFlag()}
        roles={roles}
        catalogue={catalogue}
        revision={revision}
        onChanged={afterChange}
      />
      {confirmDialog}
    </div>
  )
}
