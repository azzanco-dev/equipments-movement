'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { History } from 'lucide-react'
import { usePermissions } from '@/auth/PermissionsContext'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import { rolesPageAccess } from '@/lib/permissions'
import { rolesRpcError } from '@/lib/rolesAdmin'
import type { Permission } from '@/lib/types'
import {
  Button,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  Skeleton,
  ToastProvider,
  cn,
  useConfirm,
  useToast,
} from '@/components/ui'
import {
  fill,
  roleDescription,
  roleName,
  sortRoles,
  type RoleRow,
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
import { AllChangesContainer } from './AllChangesContainer'

type RoleQueryRow = Omit<RoleRow, 'user_count' | 'permission_count'> & {
  profile_roles: Array<{ count: number }> | null
  role_permissions: Array<{ count: number }> | null
}

/**
 * Settings › «الادوار والصلاحيات» (migration 0126), on the layout the owner
 * approved on /ui-kit (2026-10-14): the roles list at the start side, the
 * selected role's panel (permissions, users, change log) beside it, and
 * «سجل كل التغييرات» for the log of every role. The URL keeps the selected
 * role (`?role=`) and tab (`?tab=`) so Back works.
 *
 * Fail closed twice: App.tsx renders it behind its page gate and the page
 * itself needs `settings.roles` (`rolesPageAccess`). Every write goes through
 * the admin-only SECURITY DEFINER functions of 0126. The roles system is the
 * only one (0150 / 0156), so the page shows no on / off state (owner
 * 2026-10-28, «شيل تفعيل الصلاحيات»).
 *
 * A success shows as a toast at the bottom of the screen naming what was
 * saved (owner 2026-10-28, «رسالة التمام تكون واضحة»); a failure stays the
 * danger notice at the top. The toast host is local to this page.
 */
export function RolesSettings() {
  return (
    <ToastProvider>
      <RolesSettingsPage />
    </ToastProvider>
  )
}

/** How long a success toast stays: long enough to read on a phone. */
const ROLES_TOAST_MS = 6000

function RolesSettingsPage() {
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

  const [roles, setRoles] = useState<RoleRow[]>([])
  const [catalogue, setCatalogue] = useState<Permission[]>([])
  const [baseLoading, setBaseLoading] = useState(true)
  const [baseError, setBaseError] = useState(false)
  // Bumped after every write so the counts, the tabs and the audit are read
  // again.
  const [revision, setRevision] = useState(0)
  const [editorDirty, setEditorDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  // Failures only: a success is a toast.
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [roleDialog, setRoleDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; role: RoleRow } | null
  >(null)
  const [allChangesOpen, setAllChangesOpen] = useState(false)
  const { confirm, confirmDialog } = useConfirm()
  const toast = useToast()
  const notifySuccess = useCallback(
    (title: string, description?: string) =>
      void toast({
        title,
        description,
        tone: 'success',
        duration: ROLES_TOAST_MS,
      }),
    [toast],
  )

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
    setErrorMessage(null)
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
        setErrorMessage(t(rolesRpcError(error, 'roleSaveError').messageKey))
        return
      }
      notifySuccess(
        fill(t(role.is_active ? 'rolesDisabledToast' : 'rolesEnabledToast'), {
          name: roleName(lang, role),
        }),
      )
      afterChange()
    } catch {
      setErrorMessage(t('roleSaveError'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (role: RoleRow) => {
    if (role.is_system || role.user_count > 0) return
    setBusy(true)
    setErrorMessage(null)
    try {
      const { error } = await supabase.rpc('admin_delete_role', {
        p_role_key: role.key,
      })
      if (error) {
        setErrorMessage(t(rolesRpcError(error).messageKey))
        return
      }
      setEditorDirty(false)
      notifySuccess(
        fill(t('rolesDeletedToast'), { name: roleName(lang, role) }),
      )
      navigate({ role: null, tab: null }, 'replace')
      afterChange()
    } catch {
      setErrorMessage(t('rolesErrGeneric'))
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
            icon={<History size={16} aria-hidden="true" />}
            onClick={() => setAllChangesOpen(true)}
          >
            {t('rolesPageAllChanges')}
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
      {errorMessage && (
        <Notice tone="danger" onDismiss={() => setErrorMessage(null)}>
          {errorMessage}
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
                    onSavedMessage={(changes) =>
                      notifySuccess(
                        fill(t('rolePermissionsSavedToast'), {
                          name: selectedItem.name,
                        }),
                        changes,
                      )
                    }
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
                    onAssigned={(userName) =>
                      notifySuccess(
                        fill(t('roleAssignedToast'), {
                          user: userName,
                          role: selectedItem.name,
                        }),
                      )
                    }
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
        onSaved={(roleKey, created, name) => {
          setRoleDialog(null)
          notifySuccess(
            fill(t(created ? 'rolesCreatedToast' : 'rolesSavedToast'), {
              name,
            }),
          )
          if (created) navigate({ role: roleKey, tab: null }, 'push')
        }}
      />
      <AllChangesContainer
        open={allChangesOpen}
        onOpenChange={setAllChangesOpen}
        roles={roles}
        catalogue={catalogue}
        revision={revision}
      />
      {confirmDialog}
    </div>
  )
}
