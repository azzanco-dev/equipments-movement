'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import {
  PERMISSION_GROUP_LABEL_KEYS,
  SCOPE_LABEL_KEYS,
  groupPermissions,
  rolesRpcError,
  selectionScopeHints,
  scopeOptions,
  selectionFromRows,
  selectionProblems,
  selectionsEqual,
  setPermissionScope,
  tickPermission,
  toPermissionsPayload,
  untickPermission,
  type PermissionSelection,
} from '@/lib/rolesAdmin'
import type { TranslationKey } from '@/i18n/translations'
import type { Permission, RolePermission } from '@/lib/types'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorState,
  Notice,
  SectionHeader,
  Select,
  Skeleton,
  cn,
} from '@/components/ui'
import { fill, roleName, type RoleRow } from './roleRows'

type RowMessage = { key: TranslationKey; name?: string }

/**
 * The ACTIVE-mode permission set of one role, saved as a whole through
 * `admin_set_role_permissions`. Nothing here changes anybody's access while
 * the roles system is inactive (the legacy mapping is frozen in the database).
 *
 * - Ticking a key ticks its prerequisites (`requires`) and says so.
 * - A prerequisite of a ticked key cannot be unticked until that key is.
 * - `admin_only` keys are disabled for every role but admin.
 * - The admin role is read-only (it may never lose or narrow a permission).
 */
export function RolePermissionsEditor({
  role,
  catalogue,
  onDirtyChange,
  onSaved,
}: {
  role: RoleRow
  catalogue: Permission[]
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
}) {
  const { t, lang } = useI18n()
  const readOnly = role.key === 'admin'
  const [saved, setSaved] = useState<PermissionSelection | null>(null)
  const [selection, setSelection] = useState<PermissionSelection>({})
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{
    tone: 'success' | 'danger' | 'info'
    text: string
  } | null>(null)
  const [rowMessages, setRowMessages] = useState<Record<string, RowMessage>>({})
  const [blocked, setBlocked] = useState<Record<string, string[]>>({})

  const byKey = useMemo(
    () => new Map(catalogue.map((permission) => [permission.key, permission])),
    [catalogue],
  )
  const nameOf = useCallback(
    (key: string) => {
      const permission = byKey.get(key)
      if (!permission) return key
      return lang === 'ar' ? permission.name_ar : permission.name_en
    },
    [byKey, lang],
  )
  const groups = useMemo(() => groupPermissions(catalogue), [catalogue])

  const load = useCallback(async () => {
    setLoadError(false)
    setSaved(null)
    const { data, error } = await supabase
      .from('role_permissions')
      .select('permission_key,scope')
      .eq('role_key', role.key)
    if (error) {
      setLoadError(true)
      return
    }
    const rows = selectionFromRows(
      (data as Pick<RolePermission, 'permission_key' | 'scope'>[] | null) ?? [],
    )
    setSaved(rows)
    setSelection(rows)
    setRowMessages({})
    setBlocked({})
  }, [role.key])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = saved !== null && !selectionsEqual(saved, selection)
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  // Leaving the editor (another role, another tab) is guarded by the page;
  // once it is gone nothing is unsaved any more.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const problems = useMemo(
    () => selectionProblems(selection, catalogue, role.key),
    [catalogue, role.key, selection],
  )

  const scopeHints = useMemo(() => selectionScopeHints(selection), [selection])

  const toggle = (key: string, checked: boolean) => {
    setNotice(null)
    setRowMessages((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    if (checked) {
      const result = tickPermission(selection, catalogue, key)
      setSelection(result.selection)
      setBlocked({})
      if (result.autoAdded.length > 0)
        setNotice({
          tone: 'info',
          text: fill(t('rolePermissionsAutoAdded'), {
            names: result.autoAdded.map(nameOf).join('، '),
          }),
        })
      return
    }
    const result = untickPermission(selection, catalogue, key)
    if (result.blockedBy.length > 0) {
      setBlocked({ [key]: result.blockedBy })
      return
    }
    setBlocked({})
    setSelection(result.selection)
  }

  const save = async () => {
    setNotice(null)
    if (Object.keys(problems).length > 0) {
      setNotice({ tone: 'danger', text: t('rolePermissionsHasProblems') })
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.rpc('admin_set_role_permissions', {
        p_role_key: role.key,
        p_permissions: toPermissionsPayload(selection),
      })
      if (error) {
        const mapped = rolesRpcError(error, 'rolePermissionsSaveError')
        if (mapped.permissionKey && byKey.has(mapped.permissionKey)) {
          setRowMessages({
            [mapped.permissionKey]:
              mapped.code === 'missing_required_permission' &&
              mapped.requiredKey
                ? {
                    key: 'rolesErrMissingRequiredNamed',
                    name: nameOf(mapped.requiredKey),
                  }
                : { key: mapped.messageKey },
          })
          setNotice({ tone: 'danger', text: t('rolePermissionsHasProblems') })
        } else setNotice({ tone: 'danger', text: t(mapped.messageKey) })
        return
      }
      setSaved(selection)
      setRowMessages({})
      setNotice({ tone: 'success', text: t('rolePermissionsSaved') })
      onSaved()
    } catch {
      setNotice({ tone: 'danger', text: t('rolePermissionsSaveError') })
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    if (!saved) return
    setSelection(saved)
    setRowMessages({})
    setBlocked({})
    setNotice(null)
  }

  const title = fill(t('rolePermissionsTitle'), { name: roleName(lang, role) })
  const count = Object.keys(selection).length

  return (
    <Card className="space-y-4">
      <SectionHeader
        as="h2"
        title={title}
        description={t('rolePermissionsDesc')}
        action={
          <span className="flex items-center gap-2">
            {dirty && (
              <Badge tone="warning">{t('rolePermissionsUnsaved')}</Badge>
            )}
            <Badge tone="neutral">
              {fill(t('rolePermissionsCount'), { count })}
            </Badge>
          </span>
        }
      />
      {readOnly && (
        <Notice tone="info" size="compact">
          {t('rolePermissionsAdminReadOnly')}
        </Notice>
      )}
      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}
      {loadError ? (
        <ErrorState
          description={t('rolePermissionsLoadError')}
          onRetry={() => void load()}
        />
      ) : saved === null ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <fieldset key={group.key} className="space-y-1">
              <legend className="mb-1 text-sm font-semibold">
                {PERMISSION_GROUP_LABEL_KEYS[group.key]
                  ? t(PERMISSION_GROUP_LABEL_KEYS[group.key])
                  : group.key}
              </legend>
              <ul className="divide-y rounded-lg border">
                {group.permissions.map((permission) => {
                  const ticked = permission.key in selection
                  const adminOnlyLocked =
                    permission.admin_only && role.key !== 'admin'
                  const disabled =
                    readOnly || saving || (adminOnlyLocked && !ticked)
                  const options = scopeOptions(permission)
                  const message = rowMessages[permission.key]
                  const problem = problems[permission.key]
                  const blockers = blocked[permission.key]
                  const scopeHint = scopeHints[permission.key]
                  const description =
                    lang === 'ar'
                      ? permission.description_ar
                      : permission.description_en
                  return (
                    <li
                      key={permission.key}
                      className={cn(
                        'flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between',
                        (message || problem) && 'bg-danger-soft',
                      )}
                    >
                      <div className="min-w-0 space-y-1">
                        <Checkbox
                          label={
                            <span className="font-medium">
                              {nameOf(permission.key)}
                            </span>
                          }
                          checked={ticked}
                          disabled={disabled}
                          onCheckedChange={(value) =>
                            toggle(permission.key, value === true)
                          }
                        />
                        <p className="text-xs text-muted">{description}</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {permission.admin_only && (
                            <Badge size="sm" tone="info">
                              {t('rolePermissionsAdminOnlyHint')}
                            </Badge>
                          )}
                          {permission.enforced_in === 'reserved' && (
                            <Badge size="sm" tone="neutral">
                              {t('rolePermissionsReserved')}
                            </Badge>
                          )}
                          {permission.enforced_in === 'interface' && (
                            <Badge size="sm" tone="neutral">
                              {t('rolePermissionsInterfaceOnly')}
                            </Badge>
                          )}
                          {permission.requires.length > 0 && (
                            <span className="text-xs text-muted">
                              {fill(t('rolePermissionsRequires'), {
                                names: permission.requires
                                  .map(nameOf)
                                  .join('، '),
                              })}
                            </span>
                          )}
                        </div>
                        {blockers && (
                          <p className="text-xs text-warning" role="status">
                            {fill(t('rolePermissionsRequiredBy'), {
                              names: blockers.map(nameOf).join('، '),
                            })}
                          </p>
                        )}
                        {scopeHint && !problem && (
                          <p className="text-xs text-warning" role="status">
                            {t(scopeHint)}
                          </p>
                        )}
                        {(message || problem) && (
                          <p className="text-xs text-danger" role="alert">
                            {message
                              ? fill(t(message.key), {
                                  name: message.name ?? '',
                                })
                              : t(problem)}
                          </p>
                        )}
                      </div>
                      {permission.scoped && ticked && (
                        <div className="w-full shrink-0 sm:w-40">
                          <Select
                            size="sm"
                            aria-label={`${t('rolePermissionsScope')}: ${nameOf(permission.key)}`}
                            value={selection[permission.key] ?? undefined}
                            disabled={readOnly || saving}
                            invalid={problem === 'rolesErrInvalidScope'}
                            placeholder={t('rolePermissionsScope')}
                            onValueChange={(scope) => {
                              setRowMessages({})
                              setSelection((current) =>
                                setPermissionScope(
                                  current,
                                  catalogue,
                                  permission.key,
                                  scope,
                                ),
                              )
                            }}
                            options={options.map((scope) => ({
                              value: scope,
                              label: t(SCOPE_LABEL_KEYS[scope]),
                            }))}
                          />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          ))}
        </div>
      )}
      {!readOnly && saved !== null && (
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button
            variant="outline"
            disabled={!dirty || saving}
            onClick={discard}
          >
            {t('rolePermissionsReset')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!dirty}
            onClick={() => void save()}
          >
            {t('save')}
          </Button>
        </div>
      )}
    </Card>
  )
}
