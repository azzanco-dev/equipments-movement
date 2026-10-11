'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { supabase } from '@/lib/supabase'
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
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  Field,
  Input,
  Notice,
  SectionHeader,
  Skeleton,
  type DataTableColumn,
} from '@/components/ui'
import type { RolesSystemFlag } from './RolesSystemBanner'
import { fill, roleName, type RoleRow } from './roleRows'

type Loaded<T> =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; rows: T[] }

/**
 * «تفعيل نظام الادوار»: who blocks activation, what activation would change
 * for every user, and the ONLY control that changes the flag. The buttons
 * are pressed by the admin only — never triggered by the page — and each
 * needs its confirmation word typed inline first.
 */
export function RolesActivationSection({
  flag,
  roles,
  catalogue,
  revision,
  onFixOffender,
  onChanged,
}: {
  flag: RolesSystemFlag | null
  roles: RoleRow[]
  catalogue: Permission[]
  revision: number
  onFixOffender: (fullName: string) => void
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
    tone: 'success' | 'danger' | 'info' | 'warning'
    text: string
  } | null>(null)

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
    void load()
  }, [load, revision])

  const permissionName = useCallback(
    (key: string) => {
      const permission = catalogue.find((candidate) => candidate.key === key)
      if (!permission) return key
      return lang === 'ar' ? permission.name_ar : permission.name_en
    },
    [catalogue, lang],
  )
  const roleLabel = (key: string | null) => {
    if (!key) return t('roleUsersNoRole')
    const role = roles.find((candidate) => candidate.key === key)
    return role ? roleName(lang, role) : t('roleUsersUnknownRole')
  }
  const legacyLabel = (role: string) => t(roleBadge(role as UserRole).key)
  const scopeLabel = (scope: PermissionScope | null) =>
    scope ? t(SCOPE_LABEL_KEYS[scope]) : '—'

  const previewUsers = useMemo(
    () => (preview.state === 'ready' ? groupPreviewByUser(preview.rows) : []),
    [preview],
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

  const offenderColumns: DataTableColumn<RolesSystemOffender>[] = [
    {
      key: 'full_name',
      header: t('roleUsersColUser'),
      className: 'font-semibold',
      cell: (row) => row.full_name,
    },
    {
      key: 'legacy',
      header: t('roleUsersColLegacy'),
      cell: (row) => legacyLabel(row.legacy_role),
    },
    {
      key: 'new',
      header: t('roleUsersColNew'),
      cell: (row) => roleLabel(row.role_key),
    },
    {
      key: 'reason',
      header: t('rolesColStatus'),
      cell: (row) => (
        <Badge tone="danger">{t(offenderReasonKey(row.reason))}</Badge>
      ),
    },
    {
      key: 'fix',
      header: t('actions'),
      cell: (row) => (
        <Button size="sm" onClick={() => onFixOffender(row.full_name)}>
          {t('rolesOffenderFix')}
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <SectionHeader
          as="h2"
          title={t('rolesActivationTitle')}
          description={t('rolesActivationDesc')}
        />
        {result && (
          <Notice tone={result.tone} onDismiss={() => setResult(null)}>
            {result.text}
          </Notice>
        )}
        {enabled === null ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-3">
            {enabled === false &&
              offenders.state === 'ready' &&
              offenderCount > 0 && (
                <Notice tone="warning" size="compact">
                  {t('rolesEnableBlocked')}
                </Notice>
              )}
            {enabled && (
              <p className="text-sm text-muted">{t('rolesDisableDesc')}</p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field
                label={fill(t('rolesConfirmLabel'), { word })}
                name="roles_confirm"
                className="w-full sm:max-w-xs"
              >
                {(control) => (
                  <Input
                    {...control}
                    autoComplete="off"
                    spellCheck={false}
                    value={typed}
                    disabled={
                      busy ||
                      (enabled === false &&
                        (offenders.state !== 'ready' || offenderCount > 0))
                    }
                    onChange={(event) => setTyped(event.target.value)}
                  />
                )}
              </Field>
              {enabled ? (
                <Button
                  variant="danger"
                  icon={<ShieldOff size={16} aria-hidden="true" />}
                  loading={busy}
                  disabled={!canDisable}
                  onClick={() => void toggle(false)}
                >
                  {t('rolesDisableButton')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  icon={<ShieldCheck size={16} aria-hidden="true" />}
                  loading={busy}
                  disabled={!canEnable}
                  onClick={() => void toggle(true)}
                >
                  {t('rolesEnableButton')}
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      <section className="space-y-3">
        <SectionHeader
          as="h2"
          title={fill(t('rolesOffendersTitle'), {
            count: offenders.state === 'ready' ? offenderCount : '…',
          })}
        />
        {offenders.state === 'error' ? (
          <ErrorState
            description={t('rolesActivationLoadError')}
            onRetry={() => void load()}
          />
        ) : offenders.state === 'ready' && offenderCount === 0 ? (
          <Notice tone="success" size="compact">
            {t('rolesOffendersNone')}
          </Notice>
        ) : (
          <DataTable
            columns={offenderColumns}
            rows={offenders.state === 'ready' ? offenders.rows : []}
            rowKey={(row) => row.profile_id}
            loading={offenders.state === 'loading'}
            loadingRows={3}
            caption={t('rolesOffendersTitle')}
          />
        )}
      </section>

      <section className="space-y-3">
        <SectionHeader
          as="h2"
          title={t('rolesPreviewTitle')}
          description={t('rolesPreviewDesc')}
        />
        {preview.state === 'error' ? (
          <ErrorState
            description={t('rolesActivationLoadError')}
            onRetry={() => void load()}
          />
        ) : preview.state === 'loading' ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : previewUsers.length === 0 ? (
          <Notice tone="success" size="compact">
            {t('rolesPreviewNone')}
          </Notice>
        ) : (
          <ul className="space-y-3">
            {previewUsers.map((user) => (
              <li key={user.profile_id}>
                <Card className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{user.full_name}</span>
                    <Badge tone="neutral">
                      {legacyLabel(user.legacy_role)}
                    </Badge>
                    <span className="text-muted" aria-hidden="true">
                      {lang === 'ar' ? '←' : '→'}
                    </span>
                    <Badge tone="info">{roleLabel(user.role_key)}</Badge>
                  </div>
                  {user.gained.length > 0 && (
                    <PreviewLine
                      label={t('rolesPreviewGained')}
                      tone="success"
                      items={user.gained.map(
                        (row) =>
                          `${permissionName(row.permission_key)} (${scopeLabel(row.active_scope)})`,
                      )}
                    />
                  )}
                  {user.lost.length > 0 && (
                    <PreviewLine
                      label={t('rolesPreviewLost')}
                      tone="danger"
                      items={user.lost.map(
                        (row) =>
                          `${permissionName(row.permission_key)} (${scopeLabel(row.legacy_scope)})`,
                      )}
                    />
                  )}
                  {user.scope_changed.length > 0 && (
                    <PreviewLine
                      label={t('rolesPreviewScopeChanged')}
                      tone="warning"
                      items={user.scope_changed.map(
                        (row) =>
                          `${permissionName(row.permission_key)}: ${fill(
                            t('rolesPreviewScopeFromTo'),
                            {
                              from: scopeLabel(row.legacy_scope),
                              to: scopeLabel(row.active_scope),
                            },
                          )}`,
                      )}
                    />
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function PreviewLine({
  label,
  tone,
  items,
}: {
  label: string
  tone: 'success' | 'danger' | 'warning'
  items: string[]
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
      <Badge tone={tone} className="w-fit">
        {label} ({items.length})
      </Badge>
      <p className="text-sm leading-relaxed">{items.join('، ')}</p>
    </div>
  )
}
