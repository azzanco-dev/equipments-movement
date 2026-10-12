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

/**
 * wave 22B — the signed-in user's permissions, loaded once after sign-in from
 * `current_permissions()` (migration 0126) and re-loaded on demand (`reload`,
 * called by the roles page after an admin change).
 *
 * While the roles system is inactive the database answers from the frozen
 * legacy mapping of `profiles.role`, so this is exactly today's access.
 *
 * Readers: the roles settings page (to hide itself without `settings.roles`)
 * and, since wave 23, src/App.tsx through src/lib/navPermissions.ts: the
 * sidebar (step 1) and the shell / home selection plus the admin-shell page
 * guards (step 2); a `reload()` re-renders them. In-screen actions, API
 * routes and Edge Functions still decide by `profiles.role`.
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

  const load = useCallback(async (forUser: string | null) => {
    const request = ++revision.current
    if (!forUser) {
      setState({ userId: null, status: 'loading', map: EMPTY })
      return
    }
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
  }, [])

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

  const value = useMemo<PermissionsContextValue>(
    () => ({
      status,
      can: (key) => permissionScopeOf(status, map, key) !== null,
      scope: (key) => permissionScopeOf(status, map, key),
      reload,
      permissions: status === 'ready' ? map : EMPTY,
    }),
    [map, reload, status],
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
