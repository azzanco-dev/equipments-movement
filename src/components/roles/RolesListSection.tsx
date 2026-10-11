'use client'

import { useState } from 'react'
import { Edit2, KeyRound, Lock, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import { rolesRpcError } from '@/lib/rolesAdmin'
import type { Permission } from '@/lib/types'
import {
  Badge,
  Button,
  DataTable,
  IconButton,
  Notice,
  SectionHeader,
  useConfirm,
  type DataTableColumn,
} from '@/components/ui'
import { RoleFormDialog } from './RoleFormDialog'
import { RolePermissionsEditor } from './RolePermissionsEditor'
import { fill, roleName, type RoleRow } from './roleRows'

/**
 * The roles tab: every role with its counts, add/edit/delete, and the
 * permissions editor of the selected role under the list.
 */
export function RolesListSection({
  roles,
  catalogue,
  loading,
  onChanged,
  onEditorDirtyChange,
  confirmDiscard,
}: {
  roles: RoleRow[]
  catalogue: Permission[]
  loading: boolean
  onChanged: () => void
  onEditorDirtyChange: (dirty: boolean) => void
  confirmDiscard: () => Promise<boolean>
}) {
  const { t, lang } = useI18n()
  const [dialog, setDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; role: RoleRow } | null
  >(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [message, setMessage] = useState<{
    tone: 'success' | 'danger'
    text: string
  } | null>(null)
  const { confirm, confirmDialog } = useConfirm()
  const selected = roles.find((role) => role.key === selectedKey) ?? null

  const openPermissions = async (role: { key: string }) => {
    if (role.key === selectedKey) return
    if (!(await confirmDiscard())) return
    setSelectedKey(role.key)
  }

  const remove = async (role: RoleRow) => {
    if (role.is_system || role.user_count > 0) return
    const confirmed = await confirm({
      title: fill(t('rolesDeleteTitle'), { name: roleName(lang, role) }),
      description: t('rolesDeleteDesc'),
      confirmLabel: t('delete'),
      tone: 'danger',
    })
    if (!confirmed) return
    setMessage(null)
    const { error } = await supabase.rpc('admin_delete_role', {
      p_role_key: role.key,
    })
    if (error) {
      setMessage({ tone: 'danger', text: t(rolesRpcError(error).messageKey) })
      return
    }
    if (selectedKey === role.key) {
      onEditorDirtyChange(false)
      setSelectedKey(null)
    }
    setMessage({ tone: 'success', text: t('rolesDeleted') })
    onChanged()
  }

  const deleteHint = (role: RoleRow) =>
    role.is_system
      ? t('rolesDeleteSystemHint')
      : role.user_count > 0
        ? t('rolesDeleteInUseHint')
        : t('delete')

  const columns: DataTableColumn<RoleRow>[] = [
    {
      key: 'name',
      header: t('rolesColName'),
      cell: (role) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5 font-semibold">
            {roleName(lang, role)}
            {role.is_system && (
              <Badge
                size="sm"
                tone="neutral"
                icon={<Lock size={10} aria-hidden="true" />}
              >
                {t('rolesSystemBadge')}
              </Badge>
            )}
          </span>
          <span className="text-xs text-muted" dir="ltr">
            {role.key}
          </span>
        </span>
      ),
    },
    {
      key: 'description',
      header: t('rolesColDescription'),
      hideBelow: 'md',
      className: 'text-muted',
      cell: (role) =>
        (lang === 'ar'
          ? role.description_ar || role.description_en
          : role.description_en || role.description_ar) ?? '—',
    },
    {
      key: 'status',
      header: t('rolesColStatus'),
      cell: (role) =>
        role.is_active ? (
          <Badge tone="success">{t('rolesActiveBadge')}</Badge>
        ) : (
          <Badge tone="neutral">{t('rolesInactiveBadge')}</Badge>
        ),
    },
    {
      key: 'users',
      header: t('rolesColUsers'),
      align: 'center',
      cell: (role) => role.user_count,
    },
    {
      key: 'permissions',
      header: t('rolesColPermissions'),
      align: 'center',
      cell: (role) => role.permission_count,
    },
    {
      key: 'actions',
      header: t('actions'),
      cell: (role) => (
        <span className="flex items-center gap-1">
          <Button
            size="sm"
            variant={role.key === selectedKey ? 'primary' : 'outline'}
            icon={<KeyRound size={14} aria-hidden="true" />}
            onClick={() => void openPermissions(role)}
          >
            {t('rolesColPermissions')}
          </Button>
          <IconButton
            size="sm"
            label={t('edit')}
            title={t('edit')}
            icon={<Edit2 size={15} />}
            onClick={() => setDialog({ mode: 'edit', role })}
          />
          <IconButton
            size="sm"
            label={deleteHint(role)}
            title={deleteHint(role)}
            icon={<Trash2 size={15} />}
            disabled={role.is_system || role.user_count > 0}
            onClick={() => void remove(role)}
          />
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <SectionHeader
        as="h2"
        title={t('rolesTabRoles')}
        action={
          <Button
            variant="primary"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={() => setDialog({ mode: 'create' })}
          >
            {t('rolesAddRole')}
          </Button>
        }
      />
      {message && (
        <Notice tone={message.tone} onDismiss={() => setMessage(null)}>
          {message.text}
        </Notice>
      )}
      <DataTable
        columns={columns}
        rows={roles}
        rowKey={(role) => role.key}
        loading={loading}
        loadingRows={6}
        caption={t('rolesTabRoles')}
        empty={t('rolesNone')}
        rowClassName={(role) =>
          role.key === selectedKey ? 'bg-surface-hover' : undefined
        }
      />
      {selected && (
        <RolePermissionsEditor
          key={selected.key}
          role={selected}
          catalogue={catalogue}
          onDirtyChange={onEditorDirtyChange}
          onSaved={onChanged}
        />
      )}
      <RoleFormDialog
        open={dialog !== null}
        role={dialog?.mode === 'edit' ? dialog.role : null}
        existingKeys={roles.map((role) => role.key)}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
        onSaved={(saved) => {
          setDialog(null)
          setMessage({ tone: 'success', text: t('rolesSaved') })
          onChanged()
          if (dialog?.mode === 'create') void openPermissions(saved)
        }}
      />
      {confirmDialog}
    </div>
  )
}
