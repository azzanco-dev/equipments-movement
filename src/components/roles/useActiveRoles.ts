'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Role } from '@/lib/types'
import { sortRoles } from './roleRows'

export type ActiveRole = Pick<
  Role,
  'key' | 'name_ar' | 'name_en' | 'is_system' | 'created_at'
>

/**
 * wave 23 — the ACTIVE roles of `roles` (0126; readable by every signed-in
 * user) for the role selects of the users screens while the roles system is
 * ON. It is a small table, loaded whole, system roles first then by creation
 * (`sortRoles`); nothing is loaded while `enabled` is false.
 */
export function useActiveRoles(enabled: boolean): {
  roles: ActiveRole[] | null
  /** True when the read failed (the screens then fall back to the legacy
   *  roles, which are always active). */
  failed: boolean
  reload: () => void
} {
  const [state, setState] = useState<{
    roles: ActiveRole[] | null
    failed: boolean
  }>({ roles: null, failed: false })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let active = true
    supabase
      .from('roles')
      .select('key,name_ar,name_en,is_system,created_at')
      .eq('is_active', true)
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setState({ roles: null, failed: true })
          return
        }
        setState({
          roles: sortRoles((data as ActiveRole[] | null) ?? []),
          failed: false,
        })
      })
    return () => {
      active = false
    }
  }, [enabled, reloadKey])

  return {
    roles: enabled ? state.roles : null,
    failed: enabled && state.failed,
    reload: () => setReloadKey((key) => key + 1),
  }
}
