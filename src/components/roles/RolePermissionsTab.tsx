'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  PERMISSION_GROUP_LABEL_KEYS,
  groupPermissions,
  rolesRpcError,
  scopeOptions,
  selectionFromRows,
  toPermissionsPayload,
  type PermissionSelection,
} from '@/lib/rolesAdmin'
import type { Permission, RolePermission } from '@/lib/types'
import type { Language } from '@/i18n/translations'
import type { TranslationKey } from '@/i18n/translations'
import { fill } from './roleRows'
import {
  PermissionsTable,
  type Grants,
  type PermissionGroupItem,
  type PermissionItem,
  type PermissionsSaveOutcome,
} from './ui'

/** `map.view` («خريطة المشاريع») stays in the catalogue until a later
 *  migration retires it; the table never shows it (a role keeping it keeps it). */
const HIDDEN_GROUPS = new Set(['map'])
/** The reserved purchasing keys open collapsed under «لاحقاً». */
const COLLAPSED_GROUPS = new Set(['purchasing'])
const GROUP_LABEL_OVERRIDES: Record<string, TranslationKey> = {
  purchasing: 'permissionGroupLater',
}

export function toPermissionItems(
  catalogue: Permission[],
  lang: Language,
): { permissions: PermissionItem[]; groups: PermissionGroupItem[] } {
  const groups = groupPermissions(catalogue).filter(
    (group) => !HIDDEN_GROUPS.has(group.key),
  )
  return {
    permissions: groups.flatMap((group) =>
      group.permissions.map((permission) => ({
        key: permission.key,
        group: permission.group_key,
        name: lang === 'ar' ? permission.name_ar : permission.name_en,
        description:
          lang === 'ar' ? permission.description_ar : permission.description_en,
        scopes: scopeOptions(permission),
        requires: permission.requires,
        adminOnly: permission.admin_only,
        enforcedIn: permission.enforced_in,
      })),
    ),
    groups: groups.map((group) => ({
      key: group.key,
      name: '',
      collapsed: COLLAPSED_GROUPS.has(group.key),
    })),
  }
}

/**
 * The «الصلاحيات» tab of one role: reads its `role_permissions` once per mount
 * and saves the whole draft with one `admin_set_role_permissions` call.
 * Nothing here changes anybody's access while the roles system is inactive.
 */
export function RolePermissionsTab({
  roleKey,
  catalogue,
  onSaved,
  onDirtyChange,
}: {
  roleKey: string
  catalogue: Permission[]
  onSaved: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const { t, lang } = useI18n()
  const [saved, setSaved] = useState<Grants | null>(null)
  const [loadError, setLoadError] = useState(false)

  const { permissions, groups } = useMemo(() => {
    const items = toPermissionItems(catalogue, lang)
    return {
      permissions: items.permissions,
      groups: items.groups.map((group) => {
        const key =
          GROUP_LABEL_OVERRIDES[group.key] ??
          PERMISSION_GROUP_LABEL_KEYS[group.key]
        return { ...group, name: key ? t(key) : group.key }
      }),
    }
  }, [catalogue, lang, t])
  const byKey = useMemo(
    () =>
      new Map(permissions.map((permission) => [permission.key, permission])),
    [permissions],
  )

  const load = useCallback(async () => {
    setLoadError(false)
    setSaved(null)
    const { data, error } = await supabase
      .from('role_permissions')
      .select('permission_key,scope')
      .eq('role_key', roleKey)
    if (error) {
      setLoadError(true)
      return
    }
    setSaved(
      selectionFromRows(
        (data as Pick<RolePermission, 'permission_key' | 'scope'>[] | null) ??
          [],
      ),
    )
  }, [roleKey])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (draft: Grants): Promise<PermissionsSaveOutcome> => {
    try {
      const { error } = await supabase.rpc('admin_set_role_permissions', {
        p_role_key: roleKey,
        p_permissions: toPermissionsPayload(draft),
      })
      if (error) {
        const mapped = rolesRpcError(error, 'rolePermissionsSaveError')
        if (mapped.permissionKey && byKey.has(mapped.permissionKey)) {
          const rowMessage =
            mapped.code === 'missing_required_permission' && mapped.requiredKey
              ? fill(t('rolesErrMissingRequiredNamed'), {
                  name:
                    byKey.get(mapped.requiredKey)?.name ?? mapped.requiredKey,
                })
              : t(mapped.messageKey)
          return {
            ok: false,
            message: t('rolePermissionsHasProblems'),
            rows: { [mapped.permissionKey]: rowMessage },
          }
        }
        return { ok: false, message: t(mapped.messageKey) }
      }
      setSaved(draft as PermissionSelection)
      onSaved()
      return { ok: true }
    } catch {
      return { ok: false, message: t('rolePermissionsSaveError') }
    }
  }

  return (
    <PermissionsTable
      roleKey={roleKey}
      permissions={permissions}
      groups={groups}
      saved={saved}
      locked={roleKey === 'admin'}
      loadError={loadError}
      onRetry={() => void load()}
      onSave={save}
      onDirtyChange={onDirtyChange}
    />
  )
}
