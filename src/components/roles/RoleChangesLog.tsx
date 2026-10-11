'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/dateFormat'
import {
  SCOPE_LABEL_KEYS,
  roleChangeActionKey,
  roleChangeValue,
  type RoleChangeValue,
} from '@/lib/rolesAdmin'
import type { Permission, RoleChange } from '@/lib/types'
import { fetchProfileNames } from '@/components/details/profileNames'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  DataTable,
  ErrorState,
  SectionHeader,
  type DataTableColumn,
} from '@/components/ui'
import { roleName, type RoleRow } from './roleRows'

const AUDIT_LIMIT = 50

type LogRow = RoleChange & {
  changedByName: string | null
  profileName: string | null
}

/** The last 50 rows of `role_changes` (readable with `settings.roles`). */
export function RoleChangesLog({
  roles,
  catalogue,
  revision,
}: {
  roles: RoleRow[]
  catalogue: Permission[]
  revision: number
}) {
  const { t, lang } = useI18n()
  const [rows, setRows] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const startRequest = useListRequest()

  const load = useCallback(async () => {
    const signal = startRequest()
    setLoading(true)
    setLoadError(false)
    const { data, error } = await supabase
      .from('role_changes')
      .select(
        'id,changed_at,changed_by,action,role_key,permission_key,profile_id,old_value,new_value',
      )
      .order('changed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(AUDIT_LIMIT)
      .abortSignal(signal)
    if (signal.aborted) return
    if (error) {
      setLoadError(true)
      setLoading(false)
      return
    }
    const changes = (data as RoleChange[] | null) ?? []
    const names = await fetchProfileNames(
      supabase,
      changes.flatMap((row) => [row.changed_by, row.profile_id]),
      signal,
    )
    if (signal.aborted) return
    setRows(
      changes.map((row) => ({
        ...row,
        changedByName: row.changed_by
          ? (names.names.get(row.changed_by) ?? null)
          : null,
        profileName: row.profile_id
          ? (names.names.get(row.profile_id) ?? null)
          : null,
      })),
    )
    setLoading(false)
  }, [startRequest])

  useEffect(() => {
    void load()
  }, [load, revision])

  const roleLabel = (key: string | null) => {
    if (!key) return null
    const role = roles.find((candidate) => candidate.key === key)
    return role ? roleName(lang, role) : key
  }
  const permissionLabel = (key: string | null) => {
    if (!key) return null
    const permission = catalogue.find((candidate) => candidate.key === key)
    if (!permission) return key
    return lang === 'ar' ? permission.name_ar : permission.name_en
  }
  const valueLabel = (value: RoleChangeValue): string | null => {
    if (!value) return null
    if (value.kind === 'scope')
      return value.scope ? t(SCOPE_LABEL_KEYS[value.scope]) : '—'
    if (value.kind === 'role') return roleLabel(value.roleKey)
    if (value.kind === 'enabled')
      return value.enabled
        ? t('rolesSystemStatusActive')
        : t('rolesSystemStatusInactive')
    const name =
      (lang === 'ar' ? value.nameAr : value.nameEn) ??
      value.nameAr ??
      value.nameEn
    const active =
      value.active === null
        ? null
        : value.active
          ? t('rolesActiveBadge')
          : t('rolesInactiveBadge')
    return [name, active].filter(Boolean).join(' · ') || null
  }

  const columns: DataTableColumn<LogRow>[] = [
    {
      key: 'changed_at',
      header: t('roleChangesColWhen'),
      className: 'whitespace-nowrap text-muted',
      cell: (row) => formatDateTime(row.changed_at),
    },
    {
      key: 'changed_by',
      header: t('roleChangesColWho'),
      cell: (row) =>
        row.changed_by ? (row.changedByName ?? '—') : t('roleChangesSystem'),
    },
    {
      key: 'action',
      header: t('roleChangesColAction'),
      className: 'font-medium',
      cell: (row) => t(roleChangeActionKey(row.action)),
    },
    {
      key: 'subject',
      header: t('roleChangesColSubject'),
      cell: (row) =>
        [
          row.profile_id ? (row.profileName ?? '—') : null,
          roleLabel(row.role_key),
          permissionLabel(row.permission_key),
        ]
          .filter(Boolean)
          .join(' · ') || '—',
    },
    {
      key: 'change',
      header: t('roleChangesColChange'),
      hideBelow: 'md',
      className: 'text-muted',
      cell: (row) => {
        if (row.action === 'seeded') return '—'
        const from = valueLabel(roleChangeValue(row.action, row.old_value))
        const to = valueLabel(roleChangeValue(row.action, row.new_value))
        if (from && to) return `${from} ${lang === 'ar' ? '←' : '→'} ${to}`
        return to ?? from ?? '—'
      },
    },
  ]

  return (
    <div className="space-y-4">
      <SectionHeader
        as="h2"
        title={t('roleChangesTitle')}
        description={t('roleChangesDesc')}
      />
      {loadError ? (
        <ErrorState
          description={t('roleChangesLoadError')}
          onRetry={() => void load()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={8}
          caption={t('roleChangesTitle')}
          empty={t('roleChangesNone')}
        />
      )}
    </div>
  )
}
