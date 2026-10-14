'use client'

import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  mapDatabaseErrorToField,
  type DatabaseFieldRule,
} from '@/lib/formValidation'
import {
  rolesRpcError,
  selectionFromRows,
  toPermissionsPayload,
} from '@/lib/rolesAdmin'
import type { Permission, Role, RolePermission } from '@/lib/types'
import { roleName, type RoleRow } from './roleRows'
import {
  RoleFormDialog,
  type RoleFormOutcome,
  type RoleFormValues,
  type RoleItem,
} from './ui'

/** `admin_upsert_role` (0126) raised tokens and the `roles` constraints. */
const DATABASE_RULES: readonly DatabaseFieldRule<RoleFormValues>[] = [
  {
    on: 'raised',
    match: 'invalid_role_key',
    field: 'key',
    key: 'roleKeyInvalid',
  },
  {
    on: 'raised',
    match: 'role_name_taken',
    field: 'name_ar',
    key: 'roleNameTaken',
  },
  {
    on: 'raised',
    match: 'invalid_role_name',
    field: 'name_ar',
    key: 'rolesErrInvalidRoleName',
  },
  {
    on: 'raised',
    match: 'invalid_role_description',
    field: 'description_ar',
    key: 'roleDescriptionTooLong',
  },
  {
    on: 'unique',
    match: 'roles_name_ar_unique',
    field: 'name_ar',
    key: 'roleNameTaken',
  },
  { on: 'unique', match: 'roles_pkey', field: 'key', key: 'roleKeyTaken' },
]

/**
 * «اضافة دور» / «تعديل دور» against the database: `admin_upsert_role`, then
 * for «نسخ الصلاحيات من دور» the source's `role_permissions` copied with one
 * `admin_set_role_permissions` call (admin-only keys are left out, since the
 * new role is never the admin). When the copy fails the role already exists:
 * the dialog says so and offers a retry that skips the creation.
 */
export function RoleFormContainer({
  open,
  editing,
  roleItems,
  catalogue,
  onOpenChange,
  onChanged,
  onSaved,
}: {
  open: boolean
  /** null = create. */
  editing: RoleRow | null
  roleItems: RoleItem[]
  catalogue: Permission[]
  onOpenChange: (open: boolean) => void
  /** A write succeeded (the list must be read again). */
  onChanged: () => void
  /** The dialog finished with this role. */
  onSaved: (roleKey: string, created: boolean) => void
}) {
  const { t, lang } = useI18n()

  const save = async (
    values: RoleFormValues,
    copyFrom: string | null,
    createdKey: string | null,
  ): Promise<RoleFormOutcome> => {
    let roleKey = createdKey
    if (!roleKey) {
      const { data, error } = await supabase.rpc('admin_upsert_role', {
        p_key: editing ? editing.key : values.key,
        p_name_ar: values.name_ar,
        p_name_en: values.name_en,
        p_description_ar: values.description_ar || null,
        p_description_en: values.description_en || null,
        // The active flag is changed from the role header, never here.
        p_is_active: editing ? editing.is_active : true,
      })
      if (error) {
        const attributed = mapDatabaseErrorToField<RoleFormValues>(
          error,
          DATABASE_RULES,
        )
        if (attributed) return { status: 'invalid', errors: attributed }
        return {
          status: 'failed',
          message: t(rolesRpcError(error, 'roleSaveError').messageKey),
        }
      }
      roleKey = (data as Role).key
      onChanged()
      if (editing || !copyFrom) return { status: 'saved', roleKey }
    }
    if (!copyFrom) return { status: 'saved', roleKey }

    const source = await supabase
      .from('role_permissions')
      .select('permission_key,scope')
      .eq('role_key', copyFrom)
    if (source.error)
      return {
        status: 'copy_failed',
        roleKey,
        message: t('rolePermissionsLoadError'),
      }
    const adminOnly = new Set(
      catalogue.filter((permission) => permission.admin_only).map((p) => p.key),
    )
    const selection = Object.fromEntries(
      Object.entries(
        selectionFromRows(
          (source.data as
            Pick<RolePermission, 'permission_key' | 'scope'>[] | null) ?? [],
        ),
      ).filter(([key]) => !adminOnly.has(key)),
    )
    const { error } = await supabase.rpc('admin_set_role_permissions', {
      p_role_key: roleKey,
      p_permissions: toPermissionsPayload(selection),
    })
    if (error)
      return {
        status: 'copy_failed',
        roleKey,
        message: t(rolesRpcError(error, 'rolePermissionsSaveError').messageKey),
      }
    onChanged()
    return { status: 'saved', roleKey }
  }

  return (
    <RoleFormDialog
      open={open}
      role={
        editing
          ? {
              key: editing.key,
              name: roleName(lang, editing),
              name_ar: editing.name_ar,
              name_en: editing.name_en,
              description_ar: editing.description_ar ?? '',
              description_en: editing.description_en ?? '',
            }
          : null
      }
      roles={roleItems}
      onOpenChange={onOpenChange}
      onSave={save}
      onSaved={(roleKey) => onSaved(roleKey, editing === null)}
    />
  )
}
