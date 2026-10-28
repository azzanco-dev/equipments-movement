import { useMemo, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Badge, Button, EmptyState, cn } from '@/components/ui'
import {
  AssignUserDialog,
  ChangesTable,
  PermissionsTable,
  RoleFormDialog,
  RolePanel,
  RoleUsersTable,
  RolesList,
  SystemSettingsDialog,
  diffGrants,
  normalise,
  type AssignCandidate,
  type ChangeItem,
  type Grants,
  type PermissionItem,
  type RoleFormOutcome,
  type RoleFormValues,
  type RoleItem,
  type RolePanelTab,
  type RoleUserItem,
} from '@/components/roles/ui'
import {
  ADMIN_GRANTS,
  CHANGES,
  LEGACY_ROLE_LABELS,
  PERMISSIONS,
  PERMISSION_BY_KEY,
  PERMISSION_GROUPS,
  ROLES,
  SCOPE_LABELS,
  SYSTEM_STATE,
  USERS,
  type MockChange,
  type MockRole,
  type MockUser,
} from './rolesMockupData'

// MOCKUP of the roles & permissions page on /ui-kit (approved 2026-10-14). It
// renders the SAME shared components as the real page
// (`src/components/roles/ui/**`), fed with the in-memory sample data of
// rolesMockupData.ts: nothing here calls Supabase or touches the real
// `/settings/roles` page. Everything changed here stays in the page.

const PERMISSION_ITEMS: PermissionItem[] = PERMISSIONS.map((permission) => ({
  key: permission.key,
  group: permission.group,
  name: permission.name,
  description: permission.description,
  scopes: permission.scopes ?? [],
  requires: permission.requires,
  adminOnly: Boolean(permission.adminOnly),
  enforcedIn: permission.enforcedIn,
}))

const nowStamp = () => '14/10/2026 10:30'
const ACTOR = 'خالد العتيبي'

export function RolesPageMockup() {
  const [roles, setRoles] = useState<MockRole[]>(ROLES)
  const [users, setUsers] = useState<MockUser[]>(USERS)
  const [changes, setChanges] = useState<MockChange[]>(CHANGES)
  const [selectedKey, setSelectedKey] = useState<string>('supervisor')
  const [tab, setTab] = useState<RolePanelTab>('permissions')
  const [mobileView, setMobileView] = useState<'list' | 'panel'>('list')
  const [roleDialog, setRoleDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; role: MockRole } | null
  >(null)
  const [systemOpen, setSystemOpen] = useState(false)

  const selected = roles.find((role) => role.key === selectedKey) ?? roles[0]

  const roleItems: RoleItem[] = useMemo(
    () =>
      roles.map((role) => ({
        key: role.key,
        name: role.name,
        nameEn: role.nameEn,
        description: role.description || null,
        isSystem: role.isSystem,
        isActive: role.isActive,
        userCount: users.filter((user) => user.roleKey === role.key).length,
      })),
    [roles, users],
  )
  const roleName = (key: string | null) =>
    roles.find((role) => role.key === key)?.name ?? key ?? '—'

  const addChange = (roleKey: string, what: string) =>
    setChanges((current) => [
      {
        id: `c${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        roleKey,
        who: ACTOR,
        when: nowStamp(),
        what,
      },
      ...current,
    ])

  const openRole = (key: string) => {
    setSelectedKey(key)
    setTab('permissions')
    setMobileView('panel')
  }

  const saveRoleForm = async (
    values: RoleFormValues,
    copyFrom: string | null,
  ): Promise<RoleFormOutcome> => {
    if (roleDialog?.mode === 'edit') {
      const key = roleDialog.role.key
      setRoles((current) =>
        current.map((role) =>
          role.key === key
            ? {
                ...role,
                name: values.name_ar,
                nameEn: values.name_en,
                description: values.description_ar,
              }
            : role,
        ),
      )
      addChange(key, 'عدل اسم الدور او وصفه')
      return { status: 'saved', roleKey: key }
    }
    if (
      roles.some((role) => normalise(role.name) === normalise(values.name_ar))
    )
      return { status: 'invalid', errors: { name_ar: 'roleNameTaken' } }
    const source = roles.find((role) => role.key === copyFrom)
    const role: MockRole = {
      key: values.key,
      name: values.name_ar,
      nameEn: values.name_en,
      description: values.description_ar,
      isSystem: false,
      isActive: true,
      grants: source ? { ...source.grants } : {},
    }
    setRoles((current) => [...current, role])
    addChange(
      role.key,
      source ? `انشا الدور بنسخ صلاحيات «${source.name}»` : 'انشا الدور',
    )
    return { status: 'saved', roleKey: role.key }
  }

  const toggleActive = (role: MockRole) => {
    setRoles((current) =>
      current.map((item) =>
        item.key === role.key ? { ...item, isActive: !item.isActive } : item,
      ),
    )
    addChange(role.key, role.isActive ? 'عطل الدور' : 'فعل الدور')
  }

  const deleteRole = (role: MockRole) => {
    setRoles((current) => current.filter((item) => item.key !== role.key))
    setUsers((current) =>
      current.map((user) =>
        user.roleKey === role.key
          ? { ...user, roleKey: null, since: '' }
          : user,
      ),
    )
    addChange(role.key, 'حذف الدور')
    setSelectedKey('admin')
    setMobileView('list')
  }

  const saveGrants = async (role: MockRole, grants: Grants) => {
    const diff = diffGrants(role.grants, grants)
    setRoles((current) =>
      current.map((item) =>
        item.key === role.key ? { ...item, grants } : item,
      ),
    )
    for (const change of diff) {
      const name = PERMISSION_BY_KEY.get(change.key)?.name ?? change.key
      const scope = grants[change.key]
      addChange(
        role.key,
        change.kind === 'added'
          ? `اضاف «${name}»${scope ? ` بنطاق ${SCOPE_LABELS[scope]}` : ''}`
          : change.kind === 'removed'
            ? `ازال «${name}»`
            : `غير نطاق «${name}» الى ${scope ? SCOPE_LABELS[scope] : '—'}`,
      )
    }
    return { ok: true as const }
  }

  const assignUser = (user: MockUser, role: MockRole) => {
    setUsers((current) =>
      current.map((item) =>
        item.id === user.id
          ? { ...item, roleKey: role.key, since: '14/10/2026' }
          : item,
      ),
    )
    addChange(role.key, `اسند الدور الى ${user.name}`)
    if (user.roleKey && user.roleKey !== role.key)
      addChange(user.roleKey, `نقل ${user.name} الى دور «${role.name}»`)
  }

  const changeItems: ChangeItem[] = changes

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        نموذج تفاعلي ببيانات تجريبية فقط: كل ما تغيره هنا يبقى في الصفحة ولا
        يحفظ في النظام. المكونات نفسها هي مكونات الصفحة الحقيقية.
      </p>

      <div className="overflow-hidden rounded-xl border bg-bg">
        {/* Page header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold">الادوار والصلاحيات</h3>
            <p className="text-sm text-muted">
              ادارة الادوار وصلاحياتها وتعيينها للمستخدمين. لكل مستخدم دور واحد.
            </p>
          </div>
          <Button
            variant="outline"
            icon={<Settings2 size={16} aria-hidden="true" />}
            onClick={() => setSystemOpen(true)}
          >
            اعدادات النظام
            <Badge size="sm" tone="success">
              مفعّل
            </Badge>
          </Button>
        </div>

        {/* Split layout */}
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
              onSelect={openRole}
              onAdd={() => setRoleDialog({ mode: 'add' })}
            />
          </div>
          <div
            className={cn(
              'min-w-0',
              mobileView === 'list' && 'hidden lg:block',
            )}
          >
            {selected ? (
              <RolePanel
                key={selected.key}
                role={
                  roleItems.find((item) => item.key === selected.key) ??
                  roleItems[0]
                }
                usersCount={
                  users.filter((user) => user.roleKey === selected.key).length
                }
                tab={tab}
                onTabChange={setTab}
                onBack={() => setMobileView('list')}
                onEdit={() => setRoleDialog({ mode: 'edit', role: selected })}
                onToggleActive={() => toggleActive(selected)}
                onDelete={() => deleteRole(selected)}
              >
                {tab === 'permissions' && (
                  <PermissionsTable
                    roleKey={selected.key}
                    permissions={PERMISSION_ITEMS}
                    groups={PERMISSION_GROUPS}
                    saved={
                      selected.key === 'admin' ? ADMIN_GRANTS : selected.grants
                    }
                    locked={selected.key === 'admin'}
                    onSave={(grants) => saveGrants(selected, grants)}
                  />
                )}
                {tab === 'users' && (
                  <MockUsersTab
                    role={selected}
                    roles={roles}
                    users={users}
                    onAssign={(user) => assignUser(user, selected)}
                  />
                )}
                {tab === 'changes' && (
                  <MockChangesTab
                    rows={changeItems.filter(
                      (change) => change.roleKey === selected.key,
                    )}
                  />
                )}
              </RolePanel>
            ) : (
              <EmptyState title="اختر دورا من القائمة" className="m-4" />
            )}
          </div>
        </div>
      </div>

      <RoleFormDialog
        open={roleDialog !== null}
        role={
          roleDialog?.mode === 'edit'
            ? {
                key: roleDialog.role.key,
                name: roleDialog.role.name,
                name_ar: roleDialog.role.name,
                name_en: roleDialog.role.nameEn,
                description_ar: roleDialog.role.description,
                description_en: '',
              }
            : null
        }
        roles={roleItems}
        onOpenChange={(open) => {
          if (!open) setRoleDialog(null)
        }}
        onSave={saveRoleForm}
        onSaved={(roleKey) => {
          if (roleDialog?.mode === 'add') openRole(roleKey)
          setRoleDialog(null)
        }}
      />
      <MockSystemSettings
        open={systemOpen}
        onOpenChange={setSystemOpen}
        changes={changeItems}
        roleName={roleName}
      />
    </div>
  )
}

function MockUsersTab({
  role,
  roles,
  users,
  onAssign,
}: {
  role: MockRole
  roles: MockRole[]
  users: MockUser[]
  onAssign: (user: MockUser) => void
}) {
  const [assignOpen, setAssignOpen] = useState(false)
  const roleUsers: RoleUserItem[] = users
    .filter((user) => user.roleKey === role.key)
    .map((user) => ({
      id: user.id,
      name: user.name,
      since: user.since || null,
    }))
  const nameOf = (key: string) =>
    roles.find((item) => item.key === key)?.name ?? key
  const loadOptions = async (query: string): Promise<AssignCandidate[]> => {
    const q = normalise(query)
    return users
      .filter((user) => user.roleKey !== role.key)
      .filter((user) => !q || normalise(user.name).includes(q))
      .slice(0, 20)
      .map((user) => ({
        value: user.id,
        label: user.name,
        description: user.roleKey
          ? `الدور الحالي: ${nameOf(user.roleKey)}`
          : `بدون دور · ${LEGACY_ROLE_LABELS[user.legacyRole]}`,
        currentRoleName: user.roleKey ? nameOf(user.roleKey) : null,
      }))
  }
  return (
    <>
      <RoleUsersTable
        roleName={role.name}
        users={roleUsers}
        onAssignClick={() => setAssignOpen(true)}
      />
      <AssignUserDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        roleName={role.name}
        loadOptions={loadOptions}
        onAssign={async (candidate) => {
          const user = users.find((item) => item.id === candidate.value)
          if (!user) return 'المستخدم غير موجود'
          onAssign(user)
          return null
        }}
      />
    </>
  )
}

function MockChangesTab({ rows }: { rows: ChangeItem[] }) {
  const [all, setAll] = useState(false)
  return (
    <ChangesTable
      rows={all ? rows : rows.slice(0, 10)}
      canShowAll={!all && rows.length > 10}
      onShowAll={() => setAll(true)}
    />
  )
}

function MockSystemSettings({
  open,
  onOpenChange,
  changes,
  roleName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  changes: ChangeItem[]
  roleName: (key: string | null) => string
}) {
  const [all, setAll] = useState(false)
  return (
    <SystemSettingsDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setAll(false)
        onOpenChange(next)
      }}
      status={{
        state: 'ready',
        enabled: SYSTEM_STATE.enabled,
        updatedAt: SYSTEM_STATE.enabledAt,
        updatedByName: SYSTEM_STATE.enabledBy,
      }}
      log={{
        rows: all ? changes : changes.slice(0, 10),
        canShowAll: !all && changes.length > 10,
        onShowAll: () => setAll(true),
      }}
      roleLabel={roleName}
    />
  )
}
