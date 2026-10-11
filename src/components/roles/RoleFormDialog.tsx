'use client'

import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  mapDatabaseErrorToField,
  roleFormSchema,
  validateWithSchema,
  type DatabaseFieldRule,
  type FieldErrors,
} from '@/lib/formValidation'
import { rolesRpcError, suggestRoleKey } from '@/lib/rolesAdmin'
import type { Role } from '@/lib/types'
import {
  Button,
  Dialog,
  Field,
  Input,
  Notice,
  Switch,
  Textarea,
} from '@/components/ui'

export interface RoleFormValues {
  key: string
  name_ar: string
  name_en: string
  description_ar: string
  description_en: string
}

const FIELD_ORDER = [
  'key',
  'name_ar',
  'name_en',
  'description_ar',
  'description_en',
] as const

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

const EMPTY: RoleFormValues = {
  key: '',
  name_ar: '',
  name_en: '',
  description_ar: '',
  description_en: '',
}

/**
 * Add or edit a role through `admin_upsert_role`. On create the key follows
 * the English name until the admin edits it; it never changes afterwards.
 * Because the function UPDATES an existing key, the dialog refuses a key that
 * is already in the list before calling it.
 */
export function RoleFormDialog({
  open,
  role,
  existingKeys,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  /** null = create. */
  role: Role | null
  existingKeys: string[]
  onOpenChange: (open: boolean) => void
  onSaved: (role: Role) => void
}) {
  const { t } = useI18n()
  const [values, setValues] = useState<RoleFormValues>(EMPTY)
  const [active, setActive] = useState(true)
  const [keyTouched, setKeyTouched] = useState(false)
  const [errors, setErrors] = useState<FieldErrors<RoleFormValues>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const isEdit = role !== null

  useEffect(() => {
    if (!open) return
    setValues(
      role
        ? {
            key: role.key,
            name_ar: role.name_ar,
            name_en: role.name_en,
            description_ar: role.description_ar ?? '',
            description_en: role.description_en ?? '',
          }
        : EMPTY,
    )
    setActive(role ? role.is_active : true)
    setKeyTouched(false)
    setErrors({})
    setFormError(null)
  }, [open, role])

  const update = (patch: Partial<RoleFormValues>) => {
    setValues((current) => {
      const next = { ...current, ...patch }
      if (!isEdit && !keyTouched && patch.name_en !== undefined)
        next.key = suggestRoleKey(patch.name_en)
      return next
    })
    const touched = Object.keys(patch) as (keyof RoleFormValues)[]
    if (!isEdit && !keyTouched && patch.name_en !== undefined)
      touched.push('key')
    setErrors((current) => clearFieldErrors(current, touched))
  }

  const fieldError = (field: keyof RoleFormValues) =>
    errors[field] ? t(errors[field]) : undefined

  async function save() {
    setFormError(null)
    const invalid = validateWithSchema<RoleFormValues>(roleFormSchema, values)
    const key = values.key.trim().toLowerCase()
    if (!isEdit && !invalid.key && existingKeys.includes(key))
      invalid.key = 'roleKeyTaken'
    if (hasErrors(invalid)) {
      setErrors(invalid)
      focusFirstError(invalid, FIELD_ORDER, { root: bodyRef.current })
      return
    }
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('admin_upsert_role', {
        p_key: role ? role.key : key,
        p_name_ar: values.name_ar.trim(),
        p_name_en: values.name_en.trim(),
        p_description_ar: values.description_ar.trim() || null,
        p_description_en: values.description_en.trim() || null,
        // System roles always stay active (the function refuses otherwise).
        p_is_active: role?.is_system ? true : active,
      })
      if (error) {
        const attributed = mapDatabaseErrorToField<RoleFormValues>(
          error,
          DATABASE_RULES,
        )
        if (attributed) {
          setErrors(attributed)
          focusFirstError(attributed, FIELD_ORDER, { root: bodyRef.current })
          return
        }
        setFormError(t(rolesRpcError(error, 'roleSaveError').messageKey))
        return
      }
      onSaved(data as Role)
    } catch {
      setFormError(t('roleSaveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next)
      }}
      title={isEdit ? t('rolesEditRole') : t('rolesAddRole')}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {formError && <Notice tone="danger">{formError}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('roleFormNameAr')}
            name="name_ar"
            required
            error={fieldError('name_ar')}
          >
            {(control) => (
              <Input
                {...control}
                maxLength={60}
                autoComplete="off"
                value={values.name_ar}
                onChange={(event) => update({ name_ar: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={t('roleFormNameEn')}
            name="name_en"
            required
            error={fieldError('name_en')}
          >
            {(control) => (
              <Input
                {...control}
                dir="ltr"
                maxLength={60}
                autoComplete="off"
                value={values.name_en}
                onChange={(event) => update({ name_en: event.target.value })}
              />
            )}
          </Field>
        </div>
        <Field
          label={t('roleFormKey')}
          name="key"
          required
          hint={t('roleFormKeyHint')}
          error={fieldError('key')}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              readOnly={isEdit}
              disabled={isEdit}
              value={values.key}
              onChange={(event) => {
                setKeyTouched(true)
                update({ key: event.target.value.toLowerCase() })
              }}
            />
          )}
        </Field>
        <Field
          label={t('roleFormDescriptionAr')}
          name="description_ar"
          error={fieldError('description_ar')}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={500}
              value={values.description_ar}
              onChange={(event) =>
                update({ description_ar: event.target.value })
              }
            />
          )}
        </Field>
        <Field
          label={t('roleFormDescriptionEn')}
          name="description_en"
          error={fieldError('description_en')}
        >
          {(control) => (
            <Textarea
              {...control}
              dir="ltr"
              rows={2}
              maxLength={500}
              value={values.description_en}
              onChange={(event) =>
                update({ description_en: event.target.value })
              }
            />
          )}
        </Field>
        <div className="space-y-1">
          <Switch
            label={t('roleFormActive')}
            checked={role?.is_system ? true : active}
            disabled={role?.is_system === true}
            onCheckedChange={setActive}
          />
          <p className="text-xs text-muted">
            {role?.is_system
              ? t('roleFormSystemActiveHint')
              : t('roleFormActiveHint')}
          </p>
        </div>
      </div>
    </Dialog>
  )
}
