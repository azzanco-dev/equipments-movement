'use client'

import { useCallback, useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { formatDateTime } from '@/lib/dateFormat'
import type { Permission } from '@/lib/types'
import { roleName, type RoleRow, type RolesSystemFlag } from './roleRows'
import { SystemSettingsDialog, type SystemStatus } from './ui'
import { AUDIT_LIMIT, AUDIT_PREVIEW, useRoleChanges } from './useRoleChanges'

/**
 * «اعدادات النظام» against the database: the flag (read by the page) and
 * the full change log. Since roles stage 4c-2 (migration 0156) the roles
 * system is on for good and the legacy role is gone, so the blockers
 * (`admin_roles_system_offenders`), the preview
 * (`admin_roles_system_preview`, both dropped) and the activation button
 * are no longer here; nothing on this dialog writes.
 */
export function SystemSettingsContainer({
  open,
  onOpenChange,
  flag,
  flagError,
  onRetryFlag,
  roles,
  catalogue,
  revision,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  flag: RolesSystemFlag | null
  flagError: boolean
  onRetryFlag: () => void
  roles: RoleRow[]
  catalogue: Permission[]
  revision: number
}) {
  const { t, lang } = useI18n()
  const [logLimit, setLogLimit] = useState(AUDIT_PREVIEW)

  const log = useRoleChanges({
    roleKey: null,
    limit: logLimit,
    revision,
    enabled: open,
    roles,
    catalogue,
  })

  const roleLabel = useCallback(
    (key: string | null) => {
      if (!key) return t('roleUsersNoRole')
      const role = roles.find((candidate) => candidate.key === key)
      return role ? roleName(lang, role) : t('roleUsersUnknownRole')
    },
    [lang, roles, t],
  )

  const status: SystemStatus = flagError
    ? { state: 'error' }
    : flag === null
      ? { state: 'loading' }
      : {
          state: 'ready',
          enabled: flag.enabled,
          updatedAt: flag.updatedAt ? formatDateTime(flag.updatedAt) : null,
          updatedByName: flag.updatedByName,
        }

  return (
    <SystemSettingsDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setLogLimit(AUDIT_PREVIEW)
        onOpenChange(next)
      }}
      status={status}
      onRetryStatus={onRetryFlag}
      log={{
        rows: log.rows,
        loading: log.loading,
        error: log.error,
        onRetry: () => void log.reload(),
        canShowAll:
          logLimit === AUDIT_PREVIEW && log.rows.length >= AUDIT_PREVIEW,
        onShowAll: () => setLogLimit(AUDIT_LIMIT),
      }}
      roleLabel={(key) => (key ? roleLabel(key) : '—')}
    />
  )
}
