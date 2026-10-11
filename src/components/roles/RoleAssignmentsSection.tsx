'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import { buildSearchFilter } from '@/lib/search'
import { usersListConfig } from '@/lib/listConfigs'
import { formatDateTime } from '@/lib/dateFormat'
import { roleBadge } from '@/lib/userForm'
import { rolesRpcError } from '@/lib/rolesAdmin'
import type { ProfileRole, UserRole } from '@/lib/types'
import { fetchProfileNames } from '@/components/details/profileNames'
import { DataListPagination } from '@/components/data-list/DataListPagination'
import { useListRequest } from '@/components/data-list/useListRequest'
import {
  Badge,
  DataTable,
  ErrorState,
  Notice,
  SearchInput,
  SectionHeader,
  Select,
  type DataTableColumn,
} from '@/components/ui'
import { fill, roleName, type RoleRow } from './roleRows'

const PAGE_SIZE = 20

interface AssignmentRow {
  id: string
  full_name: string
  role: UserRole
  assignment: ProfileRole | null
  assignedByName: string | null
}

/**
 * Users tab: every user (the same `profiles` source and search as the users
 * list, server-side, 20 per page) with the legacy role and the new role.
 * A change calls `admin_assign_profile_role`. Admin parity is respected by
 * the options: a legacy admin can only hold «ادمن» and nobody else can get
 * it; the signed-in admin's own row is locked.
 */
export function RoleAssignmentsSection({
  roles,
  activeRoles,
  loadingRoles,
  searchSeed,
  revision,
  onChanged,
}: {
  roles: RoleRow[]
  activeRoles: RoleRow[]
  loadingRoles: boolean
  searchSeed: { term: string; seq: number } | null
  revision: number
  onChanged: () => void
}) {
  const { t, lang } = useI18n()
  const { user: currentUser } = useAuth()
  const [searchInput, setSearchInput] = useState(searchSeed?.term ?? '')
  const [search, setSearch] = useState(searchSeed?.term ?? '')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AssignmentRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const startRequest = useListRequest()

  // A «اصلاح» link from the activation tab searches for that user.
  useEffect(() => {
    if (!searchSeed) return
    setSearchInput(searchSeed.term)
    setSearch(searchSeed.term)
    setPage(1)
  }, [searchSeed])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = searchInput.trim()
      if (next === search) return
      setSearch(next)
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, searchInput])

  const load = useCallback(async () => {
    const signal = startRequest()
    setLoading(true)
    setLoadError(false)
    let query = supabase
      .from('profiles')
      .select('id,full_name,role', { count: 'exact' })
      .order('full_name', { ascending: true })
      .order('id', { ascending: true })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    const filter = buildSearchFilter(usersListConfig.searchFields, search)
    if (filter) query = query.or(filter)
    const { data, error, count } = await query.abortSignal(signal)
    if (signal.aborted) return
    if (error) {
      setLoadError(true)
      setLoading(false)
      return
    }
    const profiles =
      (data as Array<{ id: string; full_name: string; role: UserRole }>) ?? []
    const ids = profiles.map((profile) => profile.id)
    let assignments: ProfileRole[] = []
    if (ids.length > 0) {
      const assigned = await supabase
        .from('profile_roles')
        .select('profile_id,role_key,assigned_at,assigned_by')
        .in('profile_id', ids)
        .abortSignal(signal)
      if (signal.aborted) return
      if (assigned.error) {
        setLoadError(true)
        setLoading(false)
        return
      }
      assignments = (assigned.data as ProfileRole[]) ?? []
    }
    const byProfile = new Map(assignments.map((row) => [row.profile_id, row]))
    const names = await fetchProfileNames(
      supabase,
      assignments.map((row) => row.assigned_by),
      signal,
    )
    if (signal.aborted) return
    setRows(
      profiles.map((profile) => {
        const assignment = byProfile.get(profile.id) ?? null
        return {
          ...profile,
          assignment,
          assignedByName: assignment?.assigned_by
            ? (names.names.get(assignment.assigned_by) ?? null)
            : null,
        }
      }),
    )
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search, startRequest])

  useEffect(() => {
    void load()
  }, [load, revision])

  const assign = async (row: AssignmentRow, roleKey: string) => {
    if (roleKey === row.assignment?.role_key) return
    setSavingId(row.id)
    setMessage(null)
    setRowErrors((current) => {
      const next = { ...current }
      delete next[row.id]
      return next
    })
    try {
      const { error } = await supabase.rpc('admin_assign_profile_role', {
        p_profile_id: row.id,
        p_role_key: roleKey,
      })
      if (error) {
        setRowErrors((current) => ({
          ...current,
          [row.id]: t(rolesRpcError(error).messageKey),
        }))
        return
      }
      const role = roles.find((candidate) => candidate.key === roleKey)
      setMessage(
        fill(t('roleUsersAssigned'), {
          role: roleName(lang, role),
          name: row.full_name,
        }),
      )
      onChanged()
    } catch {
      setRowErrors((current) => ({
        ...current,
        [row.id]: t('rolesErrGeneric'),
      }))
    } finally {
      setSavingId(null)
    }
  }

  const roleOptionsFor = (row: AssignmentRow) => {
    const legacyAdmin = row.role === 'admin'
    const options: Array<{ value: string; label: string; disabled?: boolean }> =
      activeRoles
        .filter((role) =>
          legacyAdmin ? role.key === 'admin' : role.key !== 'admin',
        )
        .map((role) => ({ value: role.key, label: roleName(lang, role) }))
    // The current assignment stays visible even when it may not be chosen
    // again (an inactive or unknown role, or an admin-parity mismatch).
    const current = row.assignment?.role_key
    if (current && !options.some((option) => option.value === current)) {
      const role = roles.find((candidate) => candidate.key === current)
      options.unshift({
        value: current,
        label: !role
          ? t('roleUsersUnknownRole')
          : role.is_active
            ? roleName(lang, role)
            : fill(t('roleUsersInactiveRole'), { name: roleName(lang, role) }),
        disabled: true,
      })
    }
    return options
  }

  const columns: DataTableColumn<AssignmentRow>[] = [
    {
      key: 'full_name',
      header: t('roleUsersColUser'),
      className: 'font-semibold',
      cell: (row) => (
        <>
          {row.full_name}
          {row.id === currentUser?.id ? ` (${t('you')})` : ''}
        </>
      ),
    },
    {
      key: 'legacy',
      header: t('roleUsersColLegacy'),
      cell: (row) => {
        const badge = roleBadge(row.role)
        return <Badge tone={badge.tone}>{t(badge.key)}</Badge>
      },
    },
    {
      key: 'new',
      header: t('roleUsersColNew'),
      width: '16rem',
      cell: (row) => {
        const own = row.id === currentUser?.id
        const legacyAdmin = row.role === 'admin'
        const hint = own
          ? t('roleUsersOwnAdminHint')
          : legacyAdmin
            ? t('roleUsersAdminParityHint')
            : null
        const error = rowErrors[row.id]
        return (
          <div className="space-y-1">
            <Select
              size="sm"
              aria-label={`${t('roleUsersColNew')}: ${row.full_name}`}
              value={row.assignment?.role_key}
              placeholder={t('roleUsersNoRole')}
              invalid={!row.assignment || Boolean(error)}
              disabled={
                own ||
                (legacyAdmin && row.assignment?.role_key === 'admin') ||
                savingId !== null ||
                loadingRoles
              }
              options={roleOptionsFor(row)}
              onValueChange={(value) => void assign(row, value)}
            />
            {hint && <p className="text-xs text-muted">{hint}</p>}
            {!row.assignment && (
              <Badge size="sm" tone="danger">
                {t('roleUsersNoRole')}
              </Badge>
            )}
            {error && (
              <p className="text-xs text-danger" role="alert">
                {error}
              </p>
            )}
          </div>
        )
      },
    },
    {
      key: 'assigned',
      header: t('roleUsersColAssigned'),
      hideBelow: 'md',
      className: 'text-muted',
      cell: (row) =>
        row.assignment ? (
          <span className="flex flex-col text-xs">
            <span>{formatDateTime(row.assignment.assigned_at)}</span>
            {row.assignedByName && (
              <span>
                {fill(t('rolesSystemChangedBy'), { name: row.assignedByName })}
              </span>
            )}
          </span>
        ) : (
          '—'
        ),
    },
  ]

  return (
    <div className="space-y-4">
      <SectionHeader
        as="h2"
        title={t('roleUsersTitle')}
        description={t('roleUsersDesc')}
      />
      <SearchInput
        value={searchInput}
        onValueChange={setSearchInput}
        placeholder={t('roleUsersSearch')}
        className="max-w-sm"
      />
      {message && (
        <Notice tone="success" onDismiss={() => setMessage(null)}>
          {message}
        </Notice>
      )}
      {loadError ? (
        <ErrorState
          description={t('roleUsersLoadError')}
          onRetry={() => void load()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          loadingRows={6}
          caption={t('roleUsersTitle')}
          empty={t('roleUsersNone')}
        />
      )}
      {!loadError && total > 0 && (
        <DataListPagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPage={setPage}
        />
      )}
    </div>
  )
}
