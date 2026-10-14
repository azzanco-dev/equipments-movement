'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import type { Permission, RoleChange } from '@/lib/types'
import { fetchProfileNames } from '@/components/details/profileNames'
import { useListRequest } from '@/components/data-list/useListRequest'
import { describeRoleChange } from './describeRoleChange'
import { roleName, type RoleRow } from './roleRows'
import type { ChangeItem } from './ui/model'

/** The whole log shows this many rows at most (as the wave 22B page did). */
export const AUDIT_LIMIT = 50
/** A role's tab starts with this many rows; «عرض الكل» loads AUDIT_LIMIT. */
export const AUDIT_PREVIEW = 10

/**
 * The newest rows of `role_changes` (readable with `settings.roles`), for one
 * role or for all, described for the log table. Nothing is loaded while
 * `enabled` is false (a closed dialog, an unopened tab).
 */
export function useRoleChanges({
  roleKey,
  limit,
  revision,
  enabled,
  roles,
  catalogue,
}: {
  roleKey: string | null
  limit: number
  revision: number
  enabled: boolean
  roles: RoleRow[]
  catalogue: Permission[]
}) {
  const { t, lang } = useI18n()
  const [rows, setRows] = useState<ChangeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const startRequest = useListRequest()

  const load = useCallback(async () => {
    const signal = startRequest()
    setLoading(true)
    setError(false)
    let query = supabase
      .from('role_changes')
      .select(
        'id,changed_at,changed_by,action,role_key,permission_key,profile_id,old_value,new_value',
      )
      .order('changed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit)
    if (roleKey) query = query.eq('role_key', roleKey)
    const { data, error: queryError } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (queryError) {
      setError(true)
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
    const lookups = {
      t,
      lang,
      roleLabel: (key: string | null) => {
        if (!key) return null
        const role = roles.find((candidate) => candidate.key === key)
        return role ? roleName(lang, role) : key
      },
      permissionLabel: (key: string | null) => {
        if (!key) return null
        const permission = catalogue.find((candidate) => candidate.key === key)
        if (!permission) return key
        return lang === 'ar' ? permission.name_ar : permission.name_en
      },
      profileName: (id: string | null) =>
        id ? (names.names.get(id) ?? null) : null,
    }
    setRows(changes.map((row) => describeRoleChange(row, lookups)))
    setLoading(false)
  }, [catalogue, lang, limit, roleKey, roles, startRequest, t])

  useEffect(() => {
    if (!enabled) return
    void load()
  }, [enabled, load, revision])

  return { rows, loading, error, reload: load }
}
