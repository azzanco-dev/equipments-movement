'use client'

import { useCallback, useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import type { Permission } from '@/lib/types'
import { roleName, type RoleRow } from './roleRows'
import { AllChangesDialog } from './ui'
import { AUDIT_LIMIT, AUDIT_PREVIEW, useRoleChanges } from './useRoleChanges'

/**
 * «سجل كل التغييرات» against the database: the change log of every role,
 * read only while the dialog is open (10 rows, «عرض الكل» loads 50). Nothing
 * here writes.
 */
export function AllChangesContainer({
  open,
  onOpenChange,
  roles,
  catalogue,
  revision,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
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
      if (!key) return '—'
      const role = roles.find((candidate) => candidate.key === key)
      return role ? roleName(lang, role) : t('roleUsersUnknownRole')
    },
    [lang, roles, t],
  )

  return (
    <AllChangesDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setLogLimit(AUDIT_PREVIEW)
        onOpenChange(next)
      }}
      log={{
        rows: log.rows,
        loading: log.loading,
        error: log.error,
        onRetry: () => void log.reload(),
        canShowAll:
          logLimit === AUDIT_PREVIEW && log.rows.length >= AUDIT_PREVIEW,
        onShowAll: () => setLogLimit(AUDIT_LIMIT),
      }}
      roleLabel={roleLabel}
    />
  )
}
