'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import { buildSearchFilter } from '@/lib/search'
import { usersListConfig } from '@/lib/listConfigs'
import { formatDate } from '@/lib/dateFormat'
import { roleBadge } from '@/lib/userForm'
import { rolesRpcError } from '@/lib/rolesAdmin'
import type { ProfileRole, UserRole } from '@/lib/types'
import { useListRequest } from '@/components/data-list/useListRequest'
import { fill, roleName, type RoleRow } from './roleRows'
import {
  AssignUserDialog,
  RoleUsersTable,
  type AssignCandidate,
  type RoleUserItem,
} from './ui'

/** One role rarely has more than a handful of users; this is a safety cap. */
const USERS_LIMIT = 200

type ProfileLite = { id: string; full_name: string; role: UserRole }

/**
 * The «المستخدمون» tab of one role: the `profile_roles` rows of the role with
 * the users' names and legacy roles, plus «اسناد مستخدم» (a server-side search
 * over `profiles`, 20 results, excluding the users already on the role and
 * respecting admin parity) saved through `admin_assign_profile_role`.
 */
export function RoleUsersTab({
  role,
  roles,
  revision,
  onChanged,
}: {
  role: RoleRow
  roles: RoleRow[]
  revision: number
  onChanged: () => void
}) {
  const { t, lang } = useI18n()
  const [users, setUsers] = useState<RoleUserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const startRequest = useListRequest()
  const name = roleName(lang, role)

  const load = useCallback(async () => {
    const signal = startRequest()
    setLoading(true)
    setError(false)
    const assigned = await supabase
      .from('profile_roles')
      .select('profile_id,assigned_at')
      .eq('role_key', role.key)
      .order('assigned_at', { ascending: false })
      .limit(USERS_LIMIT)
      .abortSignal(signal)
    if (signal.aborted) return
    if (assigned.error) {
      setError(true)
      setLoading(false)
      return
    }
    const assignments =
      (assigned.data as Pick<ProfileRole, 'profile_id' | 'assigned_at'>[]) ?? []
    let profiles: ProfileLite[] = []
    if (assignments.length > 0) {
      const result = await supabase
        .from('profiles')
        .select('id,full_name,role')
        .in(
          'id',
          assignments.map((row) => row.profile_id),
        )
        .abortSignal(signal)
      if (signal.aborted) return
      if (result.error) {
        setError(true)
        setLoading(false)
        return
      }
      profiles = (result.data as ProfileLite[]) ?? []
    }
    const byId = new Map(profiles.map((profile) => [profile.id, profile]))
    setUsers(
      assignments.map((row) => {
        const profile = byId.get(row.profile_id)
        const badge = roleBadge(profile?.role as UserRole)
        return {
          id: row.profile_id,
          name: profile?.full_name ?? '—',
          legacyLabel: t(badge.key),
          legacyTone: badge.tone,
          since: formatDate(row.assigned_at),
        }
      }),
    )
    setLoading(false)
  }, [role.key, startRequest, t])

  useEffect(() => {
    void load()
  }, [load, revision])

  const loadCandidates = async (query: string): Promise<AssignCandidate[]> => {
    let request = supabase
      .from('profiles')
      .select('id,full_name,role')
      .order('full_name', { ascending: true })
      .limit(20)
    const filter = buildSearchFilter(usersListConfig.searchFields, query)
    if (filter) request = request.or(filter)
    // Admin parity (0126): only a legacy admin may hold «ادمن», and a legacy
    // admin holds nothing else.
    request =
      role.key === 'admin'
        ? request.eq('role', 'admin')
        : request.neq('role', 'admin')
    const { data, error: queryError } = await request
    if (queryError) throw new Error(t('roleAssignLoadError'))
    const profiles = (data as ProfileLite[]) ?? []
    if (profiles.length === 0) return []
    const assigned = await supabase
      .from('profile_roles')
      .select('profile_id,role_key')
      .in(
        'profile_id',
        profiles.map((profile) => profile.id),
      )
    if (assigned.error) throw new Error(t('roleAssignLoadError'))
    const current = new Map(
      (
        (assigned.data as Pick<ProfileRole, 'profile_id' | 'role_key'>[]) ?? []
      ).map((row) => [row.profile_id, row.role_key]),
    )
    return profiles
      .filter((profile) => current.get(profile.id) !== role.key)
      .map((profile) => {
        const currentKey = current.get(profile.id) ?? null
        const currentRole = currentKey
          ? roles.find((candidate) => candidate.key === currentKey)
          : null
        const currentRoleName = currentKey
          ? currentRole
            ? roleName(lang, currentRole)
            : currentKey
          : null
        return {
          value: profile.id,
          label: profile.full_name,
          description: currentRoleName
            ? fill(t('roleAssignCurrentRole'), { role: currentRoleName })
            : fill(t('roleAssignNoRoleYet'), {
                legacy: t(roleBadge(profile.role).key),
              }),
          currentRoleName,
        }
      })
  }

  const assign = async (candidate: AssignCandidate): Promise<string | null> => {
    try {
      const { error: rpcError } = await supabase.rpc(
        'admin_assign_profile_role',
        { p_profile_id: candidate.value, p_role_key: role.key },
      )
      if (rpcError) return t(rolesRpcError(rpcError).messageKey)
      onChanged()
      return null
    } catch {
      return t('rolesErrGeneric')
    }
  }

  return (
    <>
      <RoleUsersTable
        roleName={name}
        users={users}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        onAssignClick={() => setAssignOpen(true)}
      />
      <AssignUserDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        roleName={name}
        loadOptions={loadCandidates}
        onAssign={assign}
      />
    </>
  )
}
