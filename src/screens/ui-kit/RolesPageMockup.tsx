import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Checkbox as RadixCheckbox } from 'radix-ui'
import {
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  Info,
  Lock,
  Minus,
  Pencil,
  Plus,
  Power,
  Settings2,
  Trash2,
  UserPlus,
} from 'lucide-react'
import {
  BackButton,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Input,
  Notice,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  cn,
} from '@/components/ui'
import type { DataTableColumn } from '@/components/ui'
import { AsyncSearchSelect } from '@/components/AsyncSearchSelect'
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
  type MockGrant,
  type MockPermission,
  type MockRole,
  type MockScope,
  type MockUser,
} from './rolesMockupData'

// MOCKUP of the roles & permissions page for owner review on /ui-kit
// (direction approved 2026-10-14): a split layout with the roles list at the
// start side and the selected role's panel (permissions table, users, change
// log) on the rest. Everything is in-memory sample data from
// rolesMockupData.ts; nothing here calls Supabase or touches the real
// `/settings/roles` page. Copy is hard-coded Arabic (plain alif), as the other
// review mockups do.

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Grants `key` (at its narrowest scope) plus every transitive requirement.
 *  Returns the keys that were newly added besides `key` itself. */
export function grantWithRequirements(
  grants: MockGrant,
  key: string,
): { grants: MockGrant; added: string[] } {
  const next: MockGrant = { ...grants }
  const added: string[] = []
  const visit = (current: string) => {
    const permission = PERMISSION_BY_KEY.get(current)
    if (!permission) return
    if (!(current in next)) {
      next[current] = permission.scopes ? permission.scopes[0] : null
      if (current !== key) added.push(current)
    }
    for (const required of permission.requires) visit(required)
  }
  visit(key)
  return { grants: next, added }
}

/** Requirements of a granted key that the draft no longer holds. */
export function missingRequirements(grants: MockGrant, key: string): string[] {
  const permission = PERMISSION_BY_KEY.get(key)
  if (!permission || !(key in grants)) return []
  return permission.requires.filter((required) => !(required in grants))
}

export type GrantChange = {
  key: string
  kind: 'added' | 'removed' | 'scope'
}

export function diffGrants(base: MockGrant, draft: MockGrant): GrantChange[] {
  const changes: GrantChange[] = []
  for (const key of Object.keys(draft)) {
    if (!(key in base)) changes.push({ key, kind: 'added' })
    else if (base[key] !== draft[key]) changes.push({ key, kind: 'scope' })
  }
  for (const key of Object.keys(base)) {
    if (!(key in draft)) changes.push({ key, kind: 'removed' })
  }
  return changes
}

/** `Foreman Lead` → `foreman_lead`: lowercase, letters/digits, max 40. */
export function suggestRoleKey(nameEn: string): string {
  const key = nameEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  if (!key) return ''
  return /^[a-z]/.test(key) ? key : `r_${key}`.slice(0, 40)
}

const normalise = (value: string) => value.trim().toLowerCase()

function matchesPermission(permission: MockPermission, query: string) {
  if (!query) return true
  const q = normalise(query)
  return (
    normalise(permission.name).includes(q) ||
    normalise(permission.key).includes(q) ||
    normalise(permission.description).includes(q)
  )
}

const changesLabel = (count: number) =>
  count === 0
    ? 'لا تغييرات'
    : count === 1
      ? 'تغيير واحد'
      : count === 2
        ? 'تغييران'
        : count <= 10
          ? `${count} تغييرات`
          : `${count} تغييرا`

const usersCountLabel = (count: number) =>
  count === 0
    ? 'بدون مستخدمين'
    : count === 1
      ? 'مستخدم واحد'
      : count === 2
        ? 'مستخدمان'
        : count <= 10
          ? `${count} مستخدمين`
          : `${count} مستخدما`

const nowStamp = () => '14/10/2026 10:30'
const ACTOR = 'خالد العتيبي'

// ---------------------------------------------------------------------------
// Page mockup
// ---------------------------------------------------------------------------

export function RolesPageMockup() {
  const [roles, setRoles] = useState<MockRole[]>(ROLES)
  const [users, setUsers] = useState<MockUser[]>(USERS)
  const [changes, setChanges] = useState<MockChange[]>(CHANGES)
  const [selectedKey, setSelectedKey] = useState<string>('supervisor')
  const [mobileView, setMobileView] = useState<'list' | 'panel'>('list')
  const [roleDialog, setRoleDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; role: MockRole } | null
  >(null)
  const [systemOpen, setSystemOpen] = useState(false)

  const selected = roles.find((role) => role.key === selectedKey) ?? roles[0]

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
    setMobileView('panel')
  }

  const saveRoleForm = (values: RoleFormValues) => {
    if (roleDialog?.mode === 'edit') {
      const key = roleDialog.role.key
      setRoles((current) =>
        current.map((role) =>
          role.key === key
            ? {
                ...role,
                name: values.name,
                nameEn: values.nameEn,
                description: values.description,
              }
            : role,
        ),
      )
      addChange(key, 'عدل اسم الدور او وصفه')
    } else {
      const source = roles.find((role) => role.key === values.copyFrom)
      const role: MockRole = {
        key: values.key,
        name: values.name,
        nameEn: values.nameEn,
        description: values.description,
        isSystem: false,
        isActive: true,
        grants: source ? { ...source.grants } : {},
      }
      setRoles((current) => [...current, role])
      addChange(
        role.key,
        source ? `انشا الدور بنسخ صلاحيات «${source.name}»` : 'انشا الدور',
      )
      openRole(role.key)
    }
    setRoleDialog(null)
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

  const saveGrants = (role: MockRole, grants: MockGrant) => {
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

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        نموذج تفاعلي ببيانات تجريبية فقط: كل ما تغيره هنا يبقى في الصفحة ولا
        يحفظ في النظام. التصميم المقترح يستبدل تبويبات التفعيل وسجل التغييرات
        العلوية بزر «اعدادات النظام».
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
              roles={roles}
              users={users}
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
                role={selected}
                users={users}
                changes={changes}
                onBack={() => setMobileView('list')}
                onEdit={() => setRoleDialog({ mode: 'edit', role: selected })}
                onToggleActive={() => toggleActive(selected)}
                onDelete={() => deleteRole(selected)}
                onSaveGrants={(grants) => saveGrants(selected, grants)}
                onAssign={(user) => assignUser(user, selected)}
              />
            ) : (
              <EmptyState title="اختر دورا من القائمة" className="m-4" />
            )}
          </div>
        </div>
      </div>

      <RoleFormDialog
        state={roleDialog}
        roles={roles}
        onClose={() => setRoleDialog(null)}
        onSave={saveRoleForm}
      />
      <SystemSettingsDialog
        open={systemOpen}
        onOpenChange={setSystemOpen}
        changes={changes}
        roles={roles}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Roles list (start column)
// ---------------------------------------------------------------------------

function RolesList({
  roles,
  users,
  selectedKey,
  onSelect,
  onAdd,
}: {
  roles: MockRole[]
  users: MockUser[]
  selectedKey: string | null
  onSelect: (key: string) => void
  onAdd: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = normalise(query)
    return roles.filter(
      (role) =>
        !q ||
        normalise(role.name).includes(q) ||
        normalise(role.nameEn).includes(q) ||
        role.key.includes(q),
    )
  }, [roles, query])
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const user of users)
      if (user.roleKey) map.set(user.roleKey, (map.get(user.roleKey) ?? 0) + 1)
    return map
  }, [users])

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex gap-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="ابحث عن دور"
          className="min-w-0 flex-1"
        />
        <Button
          variant="primary"
          icon={<Plus size={16} aria-hidden="true" />}
          onClick={onAdd}
        >
          اضافة دور
        </Button>
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="لا يوجد دور بهذا الاسم" className="p-5" />
      ) : (
        <ul className="space-y-0.5" aria-label="الادوار">
          {filtered.map((role) => {
            const active = role.key === selectedKey
            const count = counts.get(role.key) ?? 0
            return (
              <li key={role.key}>
                <button
                  type="button"
                  onClick={() => onSelect(role.key)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start transition-colors',
                    active ? 'nav-active' : 'hover:bg-surface-hover',
                    !role.isActive && !active && 'opacity-60',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">
                        {role.name}
                      </span>
                      <Badge
                        size="sm"
                        tone={role.isSystem ? 'info' : 'neutral'}
                      >
                        {role.isSystem ? 'نظامي' : 'مخصص'}
                      </Badge>
                      {!role.isActive && (
                        <Badge size="sm" tone="warning">
                          معطل
                        </Badge>
                      )}
                    </span>
                    <span
                      className={cn(
                        'block text-[11px]',
                        active ? 'opacity-75' : 'text-muted',
                      )}
                    >
                      {usersCountLabel(count)}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Role panel
// ---------------------------------------------------------------------------

type PanelTab = 'permissions' | 'users' | 'changes'

function RolePanel({
  role,
  users,
  changes,
  onBack,
  onEdit,
  onToggleActive,
  onDelete,
  onSaveGrants,
  onAssign,
}: {
  role: MockRole
  users: MockUser[]
  changes: MockChange[]
  onBack: () => void
  onEdit: () => void
  onToggleActive: () => void
  onDelete: () => void
  onSaveGrants: (grants: MockGrant) => void
  onAssign: (user: MockUser) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tab, setTab] = useState<PanelTab>('permissions')
  const roleUsers = users.filter((user) => user.roleKey === role.key)
  const roleChanges = changes
    .filter((change) => change.roleKey === role.key)
    .slice(0, 10)
  const systemNote = 'الادوار النظامية لا تعطل ولا تحذف'

  return (
    <div className="flex min-w-0 flex-col">
      <div className="space-y-3 border-b px-4 py-4">
        <BackButton onClick={onBack} label="كل الادوار" className="lg:hidden" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-base font-bold">{role.name}</h4>
              <span dir="ltr" className="font-latin text-xs text-muted">
                {role.key}
              </span>
              <Badge size="sm" tone={role.isSystem ? 'info' : 'neutral'}>
                {role.isSystem ? 'نظامي' : 'مخصص'}
              </Badge>
              {!role.isActive && (
                <Badge size="sm" tone="warning">
                  معطل
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">{role.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={<Pencil size={14} aria-hidden="true" />}
              onClick={onEdit}
            >
              تعديل
            </Button>
            <DisabledTooltip note={systemNote} when={role.isSystem}>
              <Button
                size="sm"
                variant="outline"
                disabled={role.isSystem}
                icon={<Power size={14} aria-hidden="true" />}
                onClick={onToggleActive}
              >
                {role.isActive ? 'تعطيل' : 'تفعيل'}
              </Button>
            </DisabledTooltip>
            <DisabledTooltip note={systemNote} when={role.isSystem}>
              <Button
                size="sm"
                variant="danger"
                disabled={role.isSystem}
                icon={<Trash2 size={14} aria-hidden="true" />}
                onClick={() => setConfirmDelete(true)}
              >
                حذف
              </Button>
            </DisabledTooltip>
          </div>
        </div>
      </div>

      {/* The shared Tabs drive the triggers only; the panels render outside
          the Radix root, as HomeMockupShowcase does, so this Arabic-only
          review content keeps the page's RTL direction even when the Radix
          direction provider follows an English interface. */}
      <div className="min-w-0 px-4 pb-4">
        <Tabs value={tab} onValueChange={(next) => setTab(next as PanelTab)}>
          <TabsList className="pt-3">
            <TabsTrigger value="permissions">الصلاحيات</TabsTrigger>
            <TabsTrigger value="users">
              المستخدمون
              <span className="text-xs text-muted">({roleUsers.length})</span>
            </TabsTrigger>
            <TabsTrigger value="changes">سجل التغييرات</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="mt-4 min-w-0">
          {tab === 'permissions' && (
            <PermissionsTab role={role} onSave={onSaveGrants} />
          )}
          {tab === 'users' && (
            <UsersTab
              role={role}
              roleUsers={roleUsers}
              allUsers={users}
              onAssign={onAssign}
            />
          )}
          {tab === 'changes' && <ChangesTable rows={roleChanges} />}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`حذف دور «${role.name}»؟`}
        description={
          roleUsers.length
            ? `${usersCountLabel(roleUsers.length)} مسندون الى هذا الدور وسيبقون بلا دور حتى يسند لهم دور اخر.`
            : 'لا يوجد مستخدمون مسندون الى هذا الدور.'
        }
        confirmLabel="حذف"
        tone="danger"
        onConfirm={() => {
          setConfirmDelete(false)
          onDelete()
        }}
      />
    </div>
  )
}

/** Wraps a disabled control so its tooltip still shows (a disabled button
 *  receives no pointer events). */
function DisabledTooltip({
  note,
  when,
  children,
}: {
  note: string
  when: boolean
  children: ReactNode
}) {
  if (!when) return <>{children}</>
  return (
    <Tooltip content={note}>
      <span tabIndex={0} className="inline-flex rounded-lg">
        {children}
      </span>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Permissions tab
// ---------------------------------------------------------------------------

function PermissionsTab({
  role,
  onSave,
}: {
  role: MockRole
  onSave: (grants: MockGrant) => void
}) {
  const locked = role.key === 'admin'
  const [draft, setDraft] = useState<MockGrant>(() =>
    locked ? ADMIN_GRANTS : { ...role.grants },
  )
  const [query, setQuery] = useState('')
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      PERMISSION_GROUPS.map((group) => [group.key, !group.collapsed]),
    ),
  )
  const [flash, setFlash] = useState<ReadonlySet<string>>(new Set())
  const [saved, setSaved] = useState(false)
  const timers = useRef<number[]>([])
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer)
    },
    [],
  )

  const flashKeys = (keys: string[]) => {
    if (keys.length === 0) return
    setFlash(new Set(keys))
    timers.current.push(window.setTimeout(() => setFlash(new Set()), 1400))
  }

  const changes = diffGrants(role.grants, draft)

  const toggle = (key: string, on: boolean) => {
    setSaved(false)
    if (on) {
      const result = grantWithRequirements(draft, key)
      setDraft(result.grants)
      flashKeys(result.added)
    } else {
      const next = { ...draft }
      delete next[key]
      setDraft(next)
    }
  }

  const setScope = (key: string, scope: MockScope) => {
    setSaved(false)
    setDraft({ ...draft, [key]: scope })
  }

  const toggleGroup = (groupKey: string, on: boolean) => {
    setSaved(false)
    const members = PERMISSIONS.filter(
      (permission) =>
        permission.group === groupKey && !(permission.adminOnly && !locked),
    )
    if (on) {
      let next = draft
      const added: string[] = []
      for (const permission of members) {
        const result = grantWithRequirements(next, permission.key)
        next = result.grants
        added.push(
          ...result.added.filter((k) => !members.some((m) => m.key === k)),
        )
      }
      setDraft(next)
      flashKeys(added)
    } else {
      const next = { ...draft }
      for (const permission of members) delete next[permission.key]
      setDraft(next)
    }
  }

  const visibleGroups = PERMISSION_GROUPS.map((group) => ({
    group,
    all: PERMISSIONS.filter((permission) => permission.group === group.key),
    rows: PERMISSIONS.filter(
      (permission) =>
        permission.group === group.key && matchesPermission(permission, query),
    ),
  })).filter((entry) => entry.rows.length > 0)

  return (
    <div className="space-y-3">
      {locked && (
        <Notice tone="info" size="compact">
          دور الادمن يحمل كل الصلاحيات بنطاقها الاوسع ولا تنزع منه صلاحية، لذلك
          القائمة هنا للعرض فقط.
        </Notice>
      )}
      <SearchInput
        value={query}
        onValueChange={setQuery}
        placeholder="ابحث في الصلاحيات بالاسم او المفتاح"
      />

      <div
        role="table"
        aria-label="صلاحيات الدور"
        className="overflow-hidden rounded-lg border"
      >
        {visibleGroups.length === 0 && (
          <EmptyState title="لا توجد صلاحية تطابق البحث" className="m-3" />
        )}
        {visibleGroups.map(({ group, all, rows }) => {
          const granted = all.filter((permission) => permission.key in draft)
          const state: TriState =
            granted.length === 0
              ? 'none'
              : granted.length === all.length
                ? 'all'
                : 'some'
          const open = query ? true : openGroups[group.key]
          return (
            <div key={group.key} role="rowgroup">
              <div
                role="row"
                className="flex items-center gap-3 border-b bg-surface px-3 py-2"
              >
                <TriStateCheckbox
                  state={state}
                  disabled={locked}
                  label={`تحديد كل صلاحيات ${group.name}`}
                  onChange={(on) => toggleGroup(group.key, on)}
                />
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() =>
                    setOpenGroups((current) => ({
                      ...current,
                      [group.key]: !open,
                    }))
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 text-start"
                >
                  <span className="text-sm font-semibold">{group.name}</span>
                  <span className="text-xs text-muted">
                    {granted.length} من {all.length}
                  </span>
                  <ChevronDown
                    size={15}
                    aria-hidden="true"
                    className={cn(
                      'ms-auto shrink-0 text-muted transition-transform',
                      open && 'rotate-180',
                    )}
                  />
                </button>
              </div>
              {open &&
                rows.map((permission) => (
                  <PermissionRow
                    key={permission.key}
                    permission={permission}
                    draft={draft}
                    locked={locked}
                    flashed={flash.has(permission.key)}
                    onToggle={(on) => toggle(permission.key, on)}
                    onScope={(scope) => setScope(permission.key, scope)}
                  />
                ))}
            </div>
          )
        })}
      </div>

      {!locked && (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t bg-bg px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm">
            {saved ? (
              <span className="inline-flex items-center gap-1 text-success">
                <CheckCircle2 size={15} aria-hidden="true" />
                تم الحفظ
              </span>
            ) : (
              <span className={changes.length ? 'font-medium' : 'text-muted'}>
                {changesLabel(changes.length)}
              </span>
            )}
          </span>
          <span className="flex gap-2">
            <Button
              variant="outline"
              disabled={changes.length === 0}
              onClick={() => {
                setDraft({ ...role.grants })
                setSaved(false)
              }}
            >
              تراجع
            </Button>
            <Button
              variant="primary"
              disabled={changes.length === 0}
              onClick={() => {
                onSave(draft)
                setSaved(true)
              }}
            >
              حفظ
            </Button>
          </span>
        </div>
      )}
    </div>
  )
}

function PermissionRow({
  permission,
  draft,
  locked,
  flashed,
  onToggle,
  onScope,
}: {
  permission: MockPermission
  draft: MockGrant
  locked: boolean
  flashed: boolean
  onToggle: (on: boolean) => void
  onScope: (scope: MockScope) => void
}) {
  const granted = permission.key in draft
  const adminOnlyBlocked = Boolean(permission.adminOnly) && !locked
  const missing = missingRequirements(draft, permission.key)
  const requiresLabel = permission.requires
    .map((key) => PERMISSION_BY_KEY.get(key)?.name ?? key)
    .join('، ')
  const missingLabel = missing
    .map((key) => PERMISSION_BY_KEY.get(key)?.name ?? key)
    .join('، ')

  return (
    <div
      role="row"
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 border-b px-3 py-2 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center',
        'transition-colors duration-500',
        flashed && 'bg-success-soft',
      )}
    >
      <Checkbox
        checked={granted}
        disabled={locked || adminOnlyBlocked}
        aria-label={permission.name}
        onCheckedChange={(value) => onToggle(value === true)}
        className="mt-0.5 sm:mt-0"
      />
      <div role="cell" className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'text-sm font-bold',
              !granted && !locked && 'text-muted',
            )}
          >
            {permission.name}
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`وصف «${permission.name}»`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-fg"
              >
                <Info size={14} aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="max-w-72 p-3 text-xs leading-relaxed">
              <p className="mb-1 font-semibold">{permission.name}</p>
              <p dir="ltr" className="mb-1.5 font-latin text-[11px] text-muted">
                {permission.key}
              </p>
              <p>{permission.description}</p>
            </PopoverContent>
          </Popover>
          {locked && (
            <Lock size={12} aria-hidden="true" className="text-muted" />
          )}
          {permission.enforcedIn === 'interface' && (
            <Badge size="sm">واجهة فقط</Badge>
          )}
          {permission.enforcedIn === 'reserved' && (
            <Badge size="sm">محجوزة</Badge>
          )}
          {permission.adminOnly && (
            <Badge size="sm" tone="info">
              للادمن فقط
            </Badge>
          )}
          {missing.length > 0 ? (
            <Badge size="sm" tone="warning">
              تحتاج: {missingLabel} (غير ممنوحة)
            </Badge>
          ) : (
            permission.requires.length > 0 && (
              <Badge size="sm">تحتاج: {requiresLabel}</Badge>
            )
          )}
        </div>
      </div>
      <div role="cell" className="col-start-2 sm:col-start-3">
        {granted && permission.scopes && (
          <ScopeSegments
            scopes={permission.scopes}
            value={draft[permission.key] ?? permission.scopes[0]}
            disabled={locked}
            onChange={onScope}
          />
        )}
      </div>
    </div>
  )
}

/** Inline scope picker (segmented, 28 px like the toolbar controls). Built ad
 *  hoc for the mockup: the shared kit has no segmented single-choice control
 *  outside Tabs. */
function ScopeSegments({
  scopes,
  value,
  disabled,
  onChange,
}: {
  scopes: MockScope[]
  value: MockScope
  disabled?: boolean
  onChange: (scope: MockScope) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="النطاق"
      className={cn(
        'inline-flex h-7 items-center gap-0.5 rounded-lg border bg-surface p-0.5',
        disabled && 'opacity-60',
      )}
    >
      {scopes.map((scope) => {
        const active = scope === value
        return (
          <button
            key={scope}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(scope)}
            className={cn(
              'h-6 rounded-md px-2 text-xs transition-colors disabled:cursor-not-allowed',
              active
                ? 'bg-bg font-medium text-fg shadow-sm'
                : 'text-muted hover:text-fg',
            )}
          >
            {SCOPE_LABELS[scope]}
          </button>
        )
      })}
    </div>
  )
}

type TriState = 'all' | 'some' | 'none'

/** Group checkbox with an indeterminate state. Built on Radix directly because
 *  the shared Checkbox has no indeterminate rendering yet. */
function TriStateCheckbox({
  state,
  disabled,
  label,
  onChange,
}: {
  state: TriState
  disabled?: boolean
  label: string
  onChange: (on: boolean) => void
}) {
  return (
    <RadixCheckbox.Root
      checked={state === 'some' ? 'indeterminate' : state === 'all'}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={() => onChange(state !== 'all')}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border bg-bg text-primary-contrast transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
      )}
    >
      <RadixCheckbox.Indicator>
        {state === 'some' ? (
          <Minus size={13} strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check size={13} strokeWidth={3} aria-hidden="true" />
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
}

// ---------------------------------------------------------------------------
// Users tab
// ---------------------------------------------------------------------------

function UsersTab({
  role,
  roleUsers,
  allUsers,
  onAssign,
}: {
  role: MockRole
  roleUsers: MockUser[]
  allUsers: MockUser[]
  onAssign: (user: MockUser) => void
}) {
  const [assignOpen, setAssignOpen] = useState(false)
  const columns: DataTableColumn<MockUser>[] = [
    { key: 'name', header: 'المستخدم', cell: (row) => row.name },
    {
      key: 'legacy',
      header: 'الدور القديم',
      cell: (row) => (
        <Badge size="sm">{LEGACY_ROLE_LABELS[row.legacyRole]}</Badge>
      ),
    },
    {
      key: 'since',
      header: 'منذ',
      cell: (row) => <span className="text-muted">{row.since || '—'}</span>,
      hideBelow: 'sm',
    },
  ]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {usersCountLabel(roleUsers.length)} بهذا الدور. لكل مستخدم دور واحد
          فقط.
        </p>
        <Button
          size="sm"
          variant="outline"
          icon={<UserPlus size={14} aria-hidden="true" />}
          onClick={() => setAssignOpen(true)}
        >
          اسناد مستخدم
        </Button>
      </div>
      <DataTable
        size="sm"
        columns={columns}
        rows={roleUsers}
        rowKey={(row) => row.id}
        caption={`مستخدمو دور ${role.name}`}
        empty="لا يوجد مستخدمون بهذا الدور بعد"
      />
      <AssignUserDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        role={role}
        users={allUsers}
        onAssign={onAssign}
      />
    </div>
  )
}

function AssignUserDialog({
  open,
  onOpenChange,
  role,
  users,
  onAssign,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: MockRole
  users: MockUser[]
  onAssign: (user: MockUser) => void
}) {
  const [userId, setUserId] = useState('')
  const [error, setError] = useState<string | undefined>()
  const chosen = users.find((user) => user.id === userId) ?? null
  const otherRole =
    chosen?.roleKey && chosen.roleKey !== role.key
      ? (ROLES.find((item) => item.key === chosen.roleKey)?.name ??
        chosen.roleKey)
      : null

  const candidates = users.filter((user) => user.roleKey !== role.key)
  const loadOptions = async (query: string) => {
    const q = normalise(query)
    return candidates
      .filter((user) => !q || normalise(user.name).includes(q))
      .slice(0, 20)
      .map((user) => ({
        value: user.id,
        label: user.name,
        description: user.roleKey
          ? `الدور الحالي: ${ROLES.find((item) => item.key === user.roleKey)?.name ?? user.roleKey}`
          : `بدون دور · ${LEGACY_ROLE_LABELS[user.legacyRole]}`,
      }))
  }

  const close = (next: boolean) => {
    if (!next) {
      setUserId('')
      setError(undefined)
    }
    onOpenChange(next)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="sm"
      title={`اسناد مستخدم الى «${role.name}»`}
      description="ابحث عن المستخدم بالاسم. القائمة تجريبية."
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)}>
            الغاء
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!chosen) {
                setError('اختر مستخدما')
                return
              }
              onAssign(chosen)
              close(false)
            }}
          >
            اسناد
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="المستخدم" required error={error}>
          {(control) => (
            <AsyncSearchSelect
              {...control}
              value={userId}
              selectedOption={
                chosen ? { value: chosen.id, label: chosen.name } : null
              }
              onChange={(value) => {
                setUserId(value)
                setError(undefined)
              }}
              loadOptions={loadOptions}
              placeholder="اكتب اسم المستخدم"
            />
          )}
        </Field>
        {otherRole && chosen && (
          <Notice tone="warning" size="compact">
            لكل مستخدم دور واحد: {chosen.name} مسند حاليا الى «{otherRole}»
            وسينقل الى «{role.name}».
          </Notice>
        )}
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Change log
// ---------------------------------------------------------------------------

function ChangesTable({
  rows,
  withRole,
}: {
  rows: MockChange[]
  withRole?: (roleKey: string) => string
}) {
  const columns: DataTableColumn<MockChange>[] = [
    ...(withRole
      ? [
          {
            key: 'role',
            header: 'الدور',
            cell: (row: MockChange) => withRole(row.roleKey),
          },
        ]
      : []),
    { key: 'who', header: 'من', cell: (row) => row.who },
    {
      key: 'when',
      header: 'متى',
      cell: (row) => <span className="text-muted">{row.when}</span>,
      hideBelow: 'sm',
    },
    { key: 'what', header: 'ماذا', cell: (row) => row.what },
  ]
  return (
    <DataTable
      size="sm"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      caption="سجل التغييرات"
      empty="لا توجد تغييرات مسجلة"
    />
  )
}

// ---------------------------------------------------------------------------
// Add / edit role dialog
// ---------------------------------------------------------------------------

type RoleFormValues = {
  name: string
  nameEn: string
  key: string
  description: string
  copyFrom: string
}

const NO_COPY = 'none'

function RoleFormDialog({
  state,
  roles,
  onClose,
  onSave,
}: {
  state: { mode: 'add' } | { mode: 'edit'; role: MockRole } | null
  roles: MockRole[]
  onClose: () => void
  onSave: (values: RoleFormValues) => void
}) {
  const editing = state?.mode === 'edit' ? state.role : null
  // Remount the form per opening so its fields start from the right values.
  const formKey = state ? `${state.mode}:${editing?.key ?? 'new'}` : 'closed'
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={editing ? `تعديل دور «${editing.name}»` : 'اضافة دور'}
      description={
        editing
          ? 'الاسم والوصف فقط؛ المفتاح ثابت بعد الانشاء.'
          : 'اسم عربي وانجليزي، ومفتاح يقترح تلقائيا، ويمكن نسخ صلاحيات دور موجود كنقطة بداية.'
      }
    >
      <RoleForm
        key={formKey}
        editing={editing}
        roles={roles}
        onCancel={onClose}
        onSave={onSave}
      />
    </Dialog>
  )
}

function RoleForm({
  editing,
  roles,
  onCancel,
  onSave,
}: {
  editing: MockRole | null
  roles: MockRole[]
  onCancel: () => void
  onSave: (values: RoleFormValues) => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [nameEn, setNameEn] = useState(editing?.nameEn ?? '')
  const [key, setKey] = useState(editing?.key ?? '')
  const [keyTouched, setKeyTouched] = useState(Boolean(editing))
  const [description, setDescription] = useState(editing?.description ?? '')
  const [copyFrom, setCopyFrom] = useState(NO_COPY)
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next: Partial<Record<string, string>> = {}
    if (!name.trim()) next.name = 'الاسم العربي مطلوب'
    else if (
      roles.some(
        (role) =>
          role.key !== editing?.key && normalise(role.name) === normalise(name),
      )
    )
      next.name = 'يوجد دور بهذا الاسم'
    if (!nameEn.trim()) next.nameEn = 'الاسم الانجليزي مطلوب'
    if (!editing) {
      if (!/^[a-z][a-z0-9_]{1,39}$/.test(key))
        next.key =
          'المفتاح حروف انجليزية صغيرة وارقام وشرطة سفلية، يبدا بحرف، من 2 الى 40'
      else if (roles.some((role) => role.key === key))
        next.key = 'يوجد دور بهذا المفتاح'
    }
    setErrors(next)
    if (Object.keys(next).length) return
    onSave({
      name: name.trim(),
      nameEn: nameEn.trim(),
      key,
      description: description.trim(),
      copyFrom,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="الاسم بالعربية" required error={errors.name}>
          {(control) => (
            <Input
              {...control}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="مثال: رئيس الفورمين"
            />
          )}
        </Field>
        <Field label="الاسم بالانجليزية" required error={errors.nameEn}>
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              value={nameEn}
              onChange={(event) => {
                setNameEn(event.target.value)
                if (!keyTouched) setKey(suggestRoleKey(event.target.value))
              }}
              placeholder="e.g. Foreman Lead"
            />
          )}
        </Field>
      </div>
      <Field
        label="المفتاح"
        required
        error={errors.key}
        hint={
          editing
            ? 'المفتاح لا يتغير بعد الانشاء.'
            : 'يقترح من الاسم الانجليزي ويمكن تعديله.'
        }
      >
        {(control) => (
          <Input
            {...control}
            dir="ltr"
            value={key}
            readOnly={Boolean(editing)}
            disabled={Boolean(editing)}
            onChange={(event) => {
              setKeyTouched(true)
              setKey(event.target.value)
            }}
            className="font-latin"
          />
        )}
      </Field>
      <Field label="الوصف">
        {(control) => (
          <Textarea
            {...control}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="ماذا يفعل صاحب هذا الدور؟"
          />
        )}
      </Field>
      {!editing && (
        <Field
          label="نسخ الصلاحيات من دور"
          hint="نقطة بداية فقط؛ يمكن تعديل الصلاحيات بعد الانشاء."
        >
          {(control) => (
            <Select
              {...control}
              value={copyFrom}
              onValueChange={setCopyFrom}
              options={[
                { value: NO_COPY, label: 'بدون نسخ (دور فارغ)' },
                ...roles.map((role) => ({
                  value: role.key,
                  label: role.name,
                  description: `${Object.keys(role.grants).length} صلاحية`,
                })),
              ]}
            />
          )}
        </Field>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button variant="outline" onClick={onCancel}>
          الغاء
        </Button>
        <Button type="submit" variant="primary">
          {editing ? 'حفظ' : 'اضافة'}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// System settings dialog
// ---------------------------------------------------------------------------

function SystemSettingsDialog({
  open,
  onOpenChange,
  changes,
  roles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  changes: MockChange[]
  roles: MockRole[]
}) {
  const [word, setWord] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [note, setNote] = useState(false)
  const matches = word.trim() === SYSTEM_STATE.confirmationWord
  const roleName = (key: string) =>
    roles.find((role) => role.key === key)?.name ?? key

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setWord('')
          setShowLog(false)
          setNote(false)
        }
        onOpenChange(next)
      }}
      size={showLog ? 'lg' : 'md'}
      title="اعدادات النظام"
      description="حالة نظام الادوار والصلاحيات والسجل الكامل لكل الادوار."
    >
      <div className="space-y-4">
        <Notice
          tone="success"
          title="النظام مفعّل"
          icon={<CheckCircle2 size={18} aria-hidden="true" />}
        >
          منذ {SYSTEM_STATE.enabledAt} بواسطة {SYSTEM_STATE.enabledBy}.
          الصلاحيات تقرا من الادوار المسندة، والدور القديم يبقى مرجعا للمقارنة
          فقط.
        </Notice>

        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-start gap-2">
            <Ban size={16} aria-hidden="true" className="mt-0.5 text-muted" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">ايقاف النظام</p>
              <p className="text-xs text-muted">
                يرجع الجميع الى الادوار القديمة فورا. للتاكيد اكتب كلمة «
                {SYSTEM_STATE.confirmationWord}».
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="كلمة التاكيد" className="min-w-0 flex-1">
              {(control) => (
                <Input
                  {...control}
                  value={word}
                  onChange={(event) => {
                    setWord(event.target.value)
                    setNote(false)
                  }}
                  placeholder={SYSTEM_STATE.confirmationWord}
                  autoComplete="off"
                />
              )}
            </Field>
            <Button
              variant="danger"
              disabled={!matches}
              icon={<Power size={15} aria-hidden="true" />}
              onClick={() => setNote(true)}
            >
              ايقاف
            </Button>
          </div>
          {note && (
            <Notice tone="info" size="compact">
              في النموذج لا يوقف شيء فعليا؛ في الصفحة الحقيقية يستدعى
              set_roles_system_enabled.
            </Notice>
          )}
        </div>

        <div className="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ms-2 underline"
            aria-expanded={showLog}
            onClick={() => setShowLog((current) => !current)}
          >
            {showLog ? 'اخفاء السجل الكامل' : 'السجل الكامل'}
          </Button>
          {showLog && (
            <ChangesTable rows={changes.slice(0, 10)} withRole={roleName} />
          )}
        </div>
      </div>
    </Dialog>
  )
}
