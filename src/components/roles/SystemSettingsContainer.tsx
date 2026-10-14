'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
import { formatDateTime } from '@/lib/dateFormat'
import { roleBadge } from '@/lib/userForm'
import {
  SCOPE_LABEL_KEYS,
  canEnableRolesSystem,
  confirmationMatches,
  groupPreviewByUser,
  offenderReasonKey,
  parseToggleResult,
  rolesRpcError,
  type RolesSystemPreviewRow,
} from '@/lib/rolesAdmin'
import type {
  Permission,
  PermissionScope,
  RolesSystemOffender,
  UserRole,
} from '@/lib/types'
import {
  Button,
  Dialog,
  Field,
  Notice,
  Select,
  type NoticeTone,
} from '@/components/ui'
import { fill, roleName, type RoleRow, type RolesSystemFlag } from './roleRows'
import {
  SystemSettingsDialog,
  type Loaded,
  type OffenderItem,
  type PreviewUserItem,
  type SystemStatus,
} from './ui'
import { AUDIT_LIMIT, AUDIT_PREVIEW, useRoleChanges } from './useRoleChanges'

/**
 * «اعدادات النظام» against the database: the flag (read by the page), the
 * blockers (`admin_roles_system_offenders`), the preview
 * (`admin_roles_system_preview`), the full change log and the ONLY call of
 * `set_roles_system_enabled` — made when the admin presses the button after
 * typing the confirmation word, with the preview row count he acknowledged.
 * Nothing here is triggered by the page on its own.
 */
export function SystemSettingsContainer({
  open,
  onOpenChange,
  flag,
  flagError,
  onRetryFlag,
  roles,
  catalogue,
  revision,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  flag: RolesSystemFlag | null
  flagError: boolean
  onRetryFlag: () => void
  roles: RoleRow[]
  catalogue: Permission[]
  revision: number
  onChanged: () => void
}) {
  const { t, lang } = useI18n()
  const [offenders, setOffenders] = useState<Loaded<RolesSystemOffender>>({
    state: 'loading',
  })
  const [preview, setPreview] = useState<Loaded<RolesSystemPreviewRow>>({
    state: 'loading',
  })
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    tone: NoticeTone
    text: string
  } | null>(null)
  const [logLimit, setLogLimit] = useState(AUDIT_PREVIEW)
  const [fixing, setFixing] = useState<RolesSystemOffender | null>(null)

  const load = useCallback(async () => {
    setOffenders({ state: 'loading' })
    setPreview({ state: 'loading' })
    const [offendersResult, previewResult] = await Promise.all([
      supabase.rpc('admin_roles_system_offenders'),
      supabase.rpc('admin_roles_system_preview'),
    ])
    setOffenders(
      offendersResult.error
        ? { state: 'error' }
        : {
            state: 'ready',
            rows: (offendersResult.data as RolesSystemOffender[] | null) ?? [],
          },
    )
    setPreview(
      previewResult.error
        ? { state: 'error' }
        : {
            state: 'ready',
            rows: (previewResult.data as RolesSystemPreviewRow[] | null) ?? [],
          },
    )
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
  }, [load, open, revision])

  const log = useRoleChanges({
    roleKey: null,
    limit: logLimit,
    revision,
    enabled: open,
    roles,
    catalogue,
  })

  const permissionName = useCallback(
    (key: string) => {
      const permission = catalogue.find((candidate) => candidate.key === key)
      if (!permission) return key
      return lang === 'ar' ? permission.name_ar : permission.name_en
    },
    [catalogue, lang],
  )
  const roleLabel = useCallback(
    (key: string | null) => {
      if (!key) return t('roleUsersNoRole')
      const role = roles.find((candidate) => candidate.key === key)
      return role ? roleName(lang, role) : t('roleUsersUnknownRole')
    },
    [lang, roles, t],
  )
  const legacyLabel = (role: string) => t(roleBadge(role as UserRole).key)
  const scopeLabel = (scope: PermissionScope | null) =>
    scope ? t(SCOPE_LABEL_KEYS[scope]) : '—'

  const offenderItems: Loaded<OffenderItem> = useMemo(
    () =>
      offenders.state === 'ready'
        ? {
            state: 'ready',
            rows: offenders.rows.map((row) => ({
              id: row.profile_id,
              name: row.full_name,
              legacyLabel: legacyLabel(row.legacy_role),
              roleLabel: roleLabel(row.role_key),
              reasonLabel: t(offenderReasonKey(row.reason)),
            })),
          }
        : offenders,
    // legacyLabel is a plain wrapper of t.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offenders, roleLabel, t],
  )

  const previewItems: Loaded<PreviewUserItem> = useMemo(
    () =>
      preview.state === 'ready'
        ? {
            state: 'ready',
            rows: groupPreviewByUser(preview.rows).map((user) => ({
              id: user.profile_id,
              name: user.full_name,
              legacyLabel: legacyLabel(user.legacy_role),
              roleLabel: roleLabel(user.role_key),
              gained: user.gained.map(
                (row) =>
                  `${permissionName(row.permission_key)} (${scopeLabel(row.active_scope)})`,
              ),
              lost: user.lost.map(
                (row) =>
                  `${permissionName(row.permission_key)} (${scopeLabel(row.legacy_scope)})`,
              ),
              scopeChanged: user.scope_changed.map(
                (row) =>
                  `${permissionName(row.permission_key)}: ${fill(
                    t('rolesPreviewScopeFromTo'),
                    {
                      from: scopeLabel(row.legacy_scope),
                      to: scopeLabel(row.active_scope),
                    },
                  )}`,
              ),
            })),
          }
        : preview,
    // legacyLabel and scopeLabel are plain wrappers of t.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionName, preview, roleLabel, t],
  )

  const enabled = flag?.enabled ?? null
  const word = enabled
    ? t('rolesConfirmWordDisable')
    : t('rolesConfirmWordEnable')
  const offenderCount = offenders.state === 'ready' ? offenders.rows.length : 0
  const canEnable = canEnableRolesSystem({
    enabled,
    offendersLoaded: offenders.state === 'ready',
    offenderCount,
    previewLoaded: preview.state === 'ready',
    typed,
    word,
    busy,
  })
  const canDisable =
    enabled === true && !busy && confirmationMatches(typed, word)

  const toggle = async (next: boolean) => {
    // Pressed by the admin only; the word must match at the moment of the
    // click as well as for the button to be enabled.
    if (next ? !canEnable : !canDisable) return
    setBusy(true)
    setResult(null)
    try {
      const { data, error } = await supabase.rpc('set_roles_system_enabled', {
        p_enabled: next,
        // Enabling acknowledges the preview on screen by its row count; the
        // database refuses if it changed since. Disabling needs nothing.
        p_expected_preview_rows:
          next && preview.state === 'ready' ? preview.rows.length : null,
      })
      if (error) {
        setResult({
          tone: 'danger',
          text: t(rolesRpcError(error, 'rolesToggleError').messageKey),
        })
        return
      }
      const answer = parseToggleResult(data)
      if (next && answer.reason === 'offenders') {
        setTyped('')
        setOffenders({ state: 'ready', rows: answer.offenders })
        setResult({ tone: 'danger', text: t('rolesEnableRefused') })
        return
      }
      if (next && answer.reason === 'preview_changed') {
        // The preview is read again (onChanged below); the admin reviews it
        // and confirms once more.
        setTyped('')
        setResult({ tone: 'warning', text: t('rolesEnablePreviewChanged') })
        return
      }
      setTyped('')
      setResult(
        !answer.changed
          ? { tone: 'info', text: t('rolesToggleNoChange') }
          : answer.enabled
            ? { tone: 'success', text: t('rolesEnabledDone') }
            : { tone: 'success', text: t('rolesDisabledDone') },
      )
    } catch {
      setResult({ tone: 'danger', text: t('rolesToggleError') })
    } finally {
      setBusy(false)
      // Re-read the flag, the audit, the offenders and the preview.
      onChanged()
    }
  }

  const status: SystemStatus = flagError
    ? { state: 'error' }
    : flag === null
      ? { state: 'loading' }
      : {
          state: 'ready',
          enabled: flag.enabled,
          updatedAt: flag.updatedAt ? formatDateTime(flag.updatedAt) : null,
          updatedByName: flag.updatedByName,
        }

  return (
    <>
      <SystemSettingsDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setTyped('')
            setResult(null)
            setLogLimit(AUDIT_PREVIEW)
          }
          onOpenChange(next)
        }}
        status={status}
        onRetryStatus={onRetryFlag}
        activation={{
          word,
          typed,
          onTypedChange: setTyped,
          busy,
          canEnable,
          canDisable,
          onToggle: (next) => void toggle(next),
          result,
          onDismissResult: () => setResult(null),
        }}
        offenders={offenderItems}
        preview={previewItems}
        onRetryActivation={() => void load()}
        onFixOffender={(item) =>
          setFixing(
            offenders.state === 'ready'
              ? (offenders.rows.find((row) => row.profile_id === item.id) ??
                  null)
              : null,
          )
        }
        log={{
          rows: log.rows,
          loading: log.loading,
          error: log.error,
          onRetry: () => void log.reload(),
          canShowAll:
            logLimit === AUDIT_PREVIEW && log.rows.length >= AUDIT_PREVIEW,
          onShowAll: () => setLogLimit(AUDIT_LIMIT),
        }}
        roleLabel={(key) => (key ? roleLabel(key) : '—')}
      />
      <FixOffenderDialog
        offender={fixing}
        roles={roles}
        onClose={() => setFixing(null)}
        onChanged={onChanged}
      />
    </>
  )
}

/**
 * «اصلاح» of one blocker: assign an active role to that user from here (the
 * page assigns per role otherwise). Admin parity filters the options, and
 * `admin_assign_profile_role` decides in the end.
 */
function FixOffenderDialog({
  offender,
  roles,
  onClose,
  onChanged,
}: {
  offender: RolesSystemOffender | null
  roles: RoleRow[]
  onClose: () => void
  onChanged: () => void
}) {
  const { t, lang } = useI18n()
  const [roleKey, setRoleKey] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRoleKey(undefined)
    setError(undefined)
  }, [offender])

  const options = roles
    .filter(
      (role) =>
        role.is_active &&
        (offender?.legacy_role === 'admin'
          ? role.key === 'admin'
          : role.key !== 'admin'),
    )
    .map((role) => ({ value: role.key, label: roleName(lang, role) }))

  const assign = async () => {
    if (!offender) return
    if (!roleKey) {
      setError(t('rolesOffendersFixPick'))
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      const { error: rpcError } = await supabase.rpc(
        'admin_assign_profile_role',
        { p_profile_id: offender.profile_id, p_role_key: roleKey },
      )
      if (rpcError) {
        setError(t(rolesRpcError(rpcError).messageKey))
        return
      }
      onChanged()
      onClose()
    } catch {
      setError(t('rolesErrGeneric'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={offender !== null}
      onOpenChange={(next) => {
        if (!next && !saving) onClose()
      }}
      size="sm"
      title={fill(t('rolesOffendersFixTitle'), {
        name: offender?.full_name ?? '',
      })}
      description={t('rolesOffendersFixDesc')}
      footer={
        <>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={() => void assign()}
          >
            {t('roleAssignButton')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {offender && (
          <Notice tone="warning" size="compact">
            {t(offenderReasonKey(offender.reason))}
          </Notice>
        )}
        <Field label={t('rolesOffendersFixRole')} required error={error}>
          {(control) => (
            <Select
              {...control}
              value={roleKey}
              disabled={saving}
              placeholder={t('rolesOffendersFixPick')}
              options={options}
              onValueChange={(value) => {
                setRoleKey(value)
                setError(undefined)
              }}
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}
