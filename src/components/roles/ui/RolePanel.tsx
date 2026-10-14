import { useState, type ReactNode } from 'react'
import { Pencil, Power, Trash2 } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import {
  BackButton,
  Badge,
  Button,
  ConfirmDialog,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui'
import { fill } from '../roleRows'
import { DisabledTooltip } from './DisabledTooltip'
import type { RoleItem } from './model'

export type RolePanelTab = 'permissions' | 'users' | 'changes'
export const ROLE_PANEL_TABS: readonly RolePanelTab[] = [
  'permissions',
  'users',
  'changes',
]

/**
 * The selected role: header (name, LTR key, badges, description, the
 * تعديل / تعطيل|تفعيل / حذف actions with the system-role rules) and the three
 * tab triggers. The tab content is passed by the caller, so the real page can
 * load each tab's data while the mockup renders sample data.
 */
export function RolePanel({
  role,
  usersCount,
  tab,
  onTabChange,
  onBack,
  onEdit,
  onToggleActive,
  onDelete,
  busy,
  children,
}: {
  role: RoleItem
  usersCount: number
  tab: RolePanelTab
  onTabChange: (tab: RolePanelTab) => void
  onBack: () => void
  onEdit: () => void
  onToggleActive: () => void
  onDelete: () => void
  /** Disables the header actions while a write runs. */
  busy?: boolean
  children: ReactNode
}) {
  const { t } = useI18n()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const systemNote = role.isSystem ? t('rolesSystemRoleNote') : null
  const deleteNote =
    systemNote ?? (role.userCount > 0 ? t('rolesDeleteInUseHint') : null)

  return (
    <div className="flex min-w-0 flex-col">
      <div className="space-y-3 border-b px-4 py-4">
        <BackButton
          onClick={onBack}
          label={t('rolesPanelBack')}
          className="lg:hidden"
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">{role.name}</h2>
              <span dir="ltr" className="font-latin text-xs text-muted">
                {role.key}
              </span>
              <Badge size="sm" tone={role.isSystem ? 'info' : 'neutral'}>
                {role.isSystem ? t('rolesSystemBadge') : t('rolesCustomBadge')}
              </Badge>
              {!role.isActive && (
                <Badge size="sm" tone="warning">
                  {t('rolesDisabledBadge')}
                </Badge>
              )}
            </div>
            {role.description && (
              <p className="mt-1 text-sm text-muted">{role.description}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={<Pencil size={14} aria-hidden="true" />}
              disabled={busy}
              onClick={onEdit}
            >
              {t('edit')}
            </Button>
            <DisabledTooltip note={systemNote}>
              <Button
                size="sm"
                variant="outline"
                disabled={role.isSystem || busy}
                icon={<Power size={14} aria-hidden="true" />}
                onClick={onToggleActive}
              >
                {role.isActive
                  ? t('rolesActionDisable')
                  : t('rolesActionEnable')}
              </Button>
            </DisabledTooltip>
            <DisabledTooltip note={deleteNote}>
              <Button
                size="sm"
                variant="danger"
                disabled={deleteNote !== null || busy}
                icon={<Trash2 size={14} aria-hidden="true" />}
                onClick={() => setConfirmDelete(true)}
              >
                {t('delete')}
              </Button>
            </DisabledTooltip>
          </div>
        </div>
      </div>

      {/* The shared Tabs drive the triggers only; the panels render outside
          the Radix root so each tab's content can load its own data. */}
      <div className="min-w-0 px-4 pb-4">
        <Tabs
          value={tab}
          onValueChange={(next) => onTabChange(next as RolePanelTab)}
        >
          <TabsList className="pt-3">
            <TabsTrigger value="permissions">
              {t('rolesColPermissions')}
            </TabsTrigger>
            <TabsTrigger value="users">
              {t('rolesTabUsers')}
              <span className="text-xs text-muted">({usersCount})</span>
            </TabsTrigger>
            <TabsTrigger value="changes">{t('rolesTabAudit')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="mt-4 min-w-0">{children}</div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={fill(t('rolesDeleteTitle'), { name: role.name })}
        description={t('rolesDeleteDesc')}
        confirmLabel={t('delete')}
        tone="danger"
        onConfirm={() => {
          setConfirmDelete(false)
          onDelete()
        }}
      />
    </div>
  )
}
