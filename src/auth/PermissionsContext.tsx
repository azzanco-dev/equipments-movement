'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/auth/AuthContext'
import { supabase } from '@/lib/supabase'
import {
  permissionScopeOf,
  toPermissionMap,
  type PermissionsStatus,
} from '@/lib/permissions'
import type { CurrentPermission, PermissionScope } from '@/lib/types'
import {
  assignedRoleFromEmbed,
  type AssignedRole,
} from '@/lib/userRoleAssignment'

/**
 * wave 22B — the signed-in user's permissions, loaded once after sign-in from
 * `current_permissions()` (migration 0126) and re-loaded on demand (`reload`,
 * called by the roles page after an admin change).
 *
 * The database answers from the user's assigned role (`profile_roles`) only
 * since 0150; the legacy `profiles.role` was dropped by 0156.
 *
 * Readers: the roles settings page (to hide itself without `settings.roles`)
 * and, since wave 23, src/App.tsx through src/lib/navPermissions.ts: the
 * sidebar (step 1) and the shell / home selection plus the admin-shell page
 * guards (step 2); a `reload()` re-renders them. Since wave 24 the in-screen
 * actions and data decisions too (src/lib/actionPermissions.ts; since roles
 * stage 4a nothing is granted while loading or after a failed load, no role
 * fallback), and the API routes and Edge Functions check the permission
 * server-side.
 *
 * Step 3 (users screens and header) adds one read beside the permissions:
 * the signed-in user's own assignment (`profile_roles` with the role names).
 * It is loaded with the permissions and refreshed by `reload()`; its failure
 * is silent (null) and never touches `status`. The roles system flag is no
 * longer read here (2026-10-28): the system is the only one since 0150 and
 * nothing showed it any more.
 */
interface PermissionsContextValue {
  status: PermissionsStatus
  /** True when the permission is granted (false while loading or failed). */
  can: (key: string) => boolean
  /** The granted scope ('all' for an unscoped key), or null. */
  scope: (key: string) => PermissionScope | null
  /** Reads `current_permissions()` again. */
  reload: () => Promise<void>
  /** The raw map, for diagnostics; empty unless `status` is 'ready'. */
  permissions: ReadonlyMap<string, PermissionScope>
  /** The signed-in user's own `profile_roles` assignment with the role's
   *  names; null while loading, after a failed read or without assignment. */
  assignedRole: AssignedRole | null
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null)

const EMPTY: ReadonlyMap<string, PermissionScope> = new Map()

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [state, setState] = useState<{
    userId: string | null
    status: PermissionsStatus
    map: ReadonlyMap<string, PermissionScope>
  }>({ userId: null, status: 'loading', map: EMPTY })
  const revision = useRef(0)
  const [roleInfo, setRoleInfo] = useState<{
    userId: string | null
    assignedRole: AssignedRole | null
  }>({ userId: null, assignedRole: null })

  // The own assignment: one read, apart from the permissions so it cannot
  // fail them. Any failure answers null.
  const loadRoleInfo = useCallback(async (forUser: string, request: number) => {
    try {
      const assignment = await supabase
        .from('profile_roles')
        .select('role_key,roles(name_ar,name_en)')
        .eq('profile_id', forUser)
        .maybeSingle()
      if (request !== revision.current) return
      setRoleInfo({
        userId: forUser,
        assignedRole: assignment.error
          ? null
          : assignedRoleFromEmbed(assignment.data),
      })
    } catch {
      if (request === revision.current)
        setRoleInfo({ userId: forUser, assignedRole: null })
    }
  }, [])

  const load = useCallback(
    async (forUser: string | null) => {
      const request = ++revision.current
      if (!forUser) {
        setState({ userId: null, status: 'loading', map: EMPTY })
        setRoleInfo({ userId: null, assignedRole: null })
        return
      }
      void loadRoleInfo(forUser, request)
      setState((current) =>
        current.userId === forUser
          ? {
              ...current,
              status: current.status === 'ready' ? 'ready' : 'loading',
            }
          : { userId: forUser, status: 'loading', map: EMPTY },
      )
      try {
        const { data, error } = await supabase.rpc('current_permissions')
        if (request !== revision.current) return
        if (error) {
          setState({ userId: forUser, status: 'error', map: EMPTY })
          return
        }
        setState({
          userId: forUser,
          status: 'ready',
          map: toPermissionMap(data as CurrentPermission[] | null),
        })
      } catch {
        if (request === revision.current)
          setState({ userId: forUser, status: 'error', map: EMPTY })
      }
    },
    [loadRoleInfo],
  )

  useEffect(() => {
    // Like AuthContext: start the query after the auth callback has released
    // its lock.
    const timer = setTimeout(() => void load(userId), 0)
    return () => clearTimeout(timer)
  }, [load, userId])

  const reload = useCallback(() => load(userId), [load, userId])

  // A state left over from another user is never answered from.
  const status: PermissionsStatus =
    state.userId === userId ? state.status : 'loading'
  const map = state.userId === userId ? state.map : EMPTY
  const assignedRole = roleInfo.userId === userId ? roleInfo.assignedRole : null

  const value = useMemo<PermissionsContextValue>(
    () => ({
      status,
      can: (key) => permissionScopeOf(status, map, key) !== null,
      scope: (key) => permissionScopeOf(status, map, key),
      reload,
      permissions: status === 'ready' ? map : EMPTY,
      assignedRole,
    }),
    [assignedRole, map, reload, status],
  )

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  )
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext)
  if (!ctx)
    throw new Error('usePermissions must be used within PermissionsProvider')
  return ctx
}
