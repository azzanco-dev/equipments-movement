'use client'

import { useState } from 'react'
import type { Permission } from '@/lib/types'
import type { RoleRow } from './roleRows'
import { ChangesTable } from './ui'
import { AUDIT_LIMIT, AUDIT_PREVIEW, useRoleChanges } from './useRoleChanges'

/** The «سجل التغييرات» tab of one role: 10 rows, «عرض الكل» loads 50. */
export function RoleChangesTab({
  roleKey,
  roles,
  catalogue,
  revision,
}: {
  roleKey: string
  roles: RoleRow[]
  catalogue: Permission[]
  revision: number
}) {
  const [limit, setLimit] = useState(AUDIT_PREVIEW)
  const log = useRoleChanges({
    roleKey,
    limit,
    revision,
    enabled: true,
    roles,
    catalogue,
  })
  return (
    <ChangesTable
      rows={log.rows}
      loading={log.loading}
      error={log.error}
      onRetry={() => void log.reload()}
      canShowAll={limit === AUDIT_PREVIEW && log.rows.length >= AUDIT_PREVIEW}
      onShowAll={() => setLimit(AUDIT_LIMIT)}
    />
  )
}
