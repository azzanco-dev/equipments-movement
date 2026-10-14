import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import {
  clearFieldErrors,
  focusFirstError,
  hasErrors,
  roleFormSchema,
  validateWithSchema,
  type FieldErrors,
} from '@/lib/formValidation'
import { suggestRoleKey } from '@/lib/rolesAdmin'
import {
  Button,
  Dialog,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
} from '@/components/ui'
import { fill } from '../roleRows'
import type { RoleItem } from './model'

export interface RoleFormValues {
  key: string
  name_ar: string
  name_en: string
  description_ar: string
  description_en: string
}

/** The role being edited: its names and descriptions in both languages. */
export interface RoleFormRole {
  key: string
  name: string
  name_ar: string
  name_en: string
  description_ar: string
  description_en: string
}

export type RoleFormOutcome =
  | { status: 'saved'; roleKey: string }
  | { status: 'invalid'; errors: FieldErrors<RoleFormValues> }
  | { status: 'failed'; message: string }
  /** Create only: the role exists but copying the permissions failed. */
  | { status: 'copy_failed'; roleKey: string; message: string }

export const FIELD_ORDER = [
  'key',
  'name_ar',
  'name_en',
  'description_ar',
  'description_en',
] as const

const EMPTY: RoleFormValues = {
  key: '',
  name_ar: '',
  name_en: '',
  description_ar: '',
  description_en: '',
}

const NO_COPY = 'none'

/**
 * «اضافة دور» / «تعديل دور». On create the key follows the English name
 * until the admin edits it, and «نسخ الصلاحيات من دور» offers an existing
 * role's permissions as a starting point. The caller saves (`admin_upsert_role`,
 * then `admin_set_role_permissions` for the copy): `onSave` receives the values,
 * the chosen source role (null for none) and, on a retry after `copy_failed`,
 * the key of the role already created so nothing is created twice.
 */
export function RoleFormDialog({
  open,
  role,
  roles,
  onOpenChange,
  onSave,
  onSaved,
}: {
  open: boolean
  /** null = create. */
  role: RoleFormRole | null
  /** Every role, for the key check and the copy-from list. */
  roles: RoleItem[]
  onOpenChange: (open: boolean) => void
  onSave: (
    values: RoleFormValues,
    copyFrom: string | null,
    createdKey: string | null,
  ) => Promise<RoleFormOutcome>
  /** The dialog is done: saved, or closed after `copy_failed`. */
  onSaved: (roleKey: string) => void
}) {
  const { t } = useI18n()
  const [values, setValues] = useState<RoleFormValues>(EMPTY)
  const [copyFrom, setCopyFrom] = useState(NO_COPY)
  const [keyTouched, setKeyTouched] = useState(false)
  const [errors, setErrors] = useState<FieldErrors<RoleFormValues>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState<{
    roleKey: string
    message: string
  } | null>(null)
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
            description_ar: role.description_ar,
            description_en: role.description_en,
          }
        : EMPTY,
    )
    setCopyFrom(NO_COPY)
    setKeyTouched(false)
    setErrors({})
    setFormError(null)
    setCopyFailed(null)
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

  const close = (next: boolean) => {
    if (saving) return
    if (!next && copyFailed) {
      // The role exists already; leaving the dialog selects it.
      onSaved(copyFailed.roleKey)
    }
    onOpenChange(next)
  }

  const save = async () => {
    setFormError(null)
    const trimmed: RoleFormValues = {
      key: values.key.trim().toLowerCase(),
      name_ar: values.name_ar.trim(),
      name_en: values.name_en.trim(),
      description_ar: values.description_ar.trim(),
      description_en: values.description_en.trim(),
    }
    if (!copyFailed) {
      const invalid = validateWithSchema<RoleFormValues>(
        roleFormSchema,
        trimmed,
      )
      if (
        !isEdit &&
        !invalid.key &&
        roles.some((candidate) => candidate.key === trimmed.key)
      )
        invalid.key = 'roleKeyTaken'
      if (hasErrors(invalid)) {
        setErrors(invalid)
        focusFirstError(invalid, FIELD_ORDER, { root: bodyRef.current })
        return
      }
    }
    setSaving(true)
    try {
      const outcome = await onSave(
        trimmed,
        copyFrom === NO_COPY ? null : copyFrom,
        copyFailed?.roleKey ?? null,
      )
      if (outcome.status === 'invalid') {
        setErrors(outcome.errors)
        focusFirstError(outcome.errors, FIELD_ORDER, { root: bodyRef.current })
        return
      }
      if (outcome.status === 'failed') {
        setFormError(outcome.message)
        return
      }
      if (outcome.status === 'copy_failed') {
        setCopyFailed({ roleKey: outcome.roleKey, message: outcome.message })
        return
      }
      setCopyFailed(null)
      onSaved(outcome.roleKey)
      onOpenChange(false)
    } catch {
      setFormError(t('roleSaveError'))
    } finally {
      setSaving(false)
    }
  }

  const copyOptions = [
    { value: NO_COPY, label: t('roleFormCopyNone') },
    ...roles.map((candidate) => ({
      value: candidate.key,
      label: candidate.name,
    })),
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="md"
      title={
        role
          ? fill(t('rolesEditRoleNamed'), { name: role.name })
          : t('rolesAddRole')
      }
      description={
        isEdit ? t('roleFormDialogDescEdit') : t('roleFormDialogDescAdd')
      }
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => close(false)}
          >
            {copyFailed ? t('close') : t('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={() => void save()}
          >
            {copyFailed
              ? t('roleFormRetryCopy')
              : isEdit
                ? t('save')
                : t('roleFormAdd')}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {formError && <Notice tone="danger">{formError}</Notice>}
        {copyFailed && (
          <Notice tone="warning">
            {fill(t('roleFormCopyFailed'), { message: copyFailed.message })}
          </Notice>
        )}
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
                disabled={saving || copyFailed !== null}
                value={values.name_ar}
                placeholder={t('roleFormNamePlaceholderAr')}
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
                disabled={saving || copyFailed !== null}
                value={values.name_en}
                placeholder={t('roleFormNamePlaceholderEn')}
                onChange={(event) => update({ name_en: event.target.value })}
              />
            )}
          </Field>
        </div>
        <Field
          label={t('roleFormKey')}
          name="key"
          required
          hint={isEdit ? t('roleFormKeyFixedHint') : t('roleFormKeyHint')}
          error={fieldError('key')}
        >
          {(control) => (
            <Input
              {...control}
              dir="ltr"
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              readOnly={isEdit || copyFailed !== null}
              disabled={isEdit || saving || copyFailed !== null}
              className="font-latin"
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
              disabled={saving || copyFailed !== null}
              value={values.description_ar}
              placeholder={t('roleFormDescriptionPlaceholder')}
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
              disabled={saving || copyFailed !== null}
              value={values.description_en}
              onChange={(event) =>
                update({ description_en: event.target.value })
              }
            />
          )}
        </Field>
        {!isEdit && (
          <Field
            label={t('roleFormCopyFrom')}
            name="copy_from"
            hint={t('roleFormCopyFromHint')}
          >
            {(control) => (
              <Select
                {...control}
                value={copyFrom}
                disabled={saving}
                onValueChange={setCopyFrom}
                options={copyOptions}
              />
            )}
          </Field>
        )}
      </div>
    </Dialog>
  )
}
