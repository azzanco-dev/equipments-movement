import { useState } from 'react'
import { Ban, Power, ShieldCheck, ShieldOff } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Input,
  Notice,
  Skeleton,
  type DataTableColumn,
  type NoticeTone,
} from '@/components/ui'
import { fill } from '../roleRows'
import { ChangesTable } from './ChangesTable'
import type { ChangeItem, Loaded, OffenderItem, PreviewUserItem } from './model'

export type SystemStatus =
  | { state: 'loading' }
  | { state: 'error' }
  | {
      state: 'ready'
      enabled: boolean
      updatedAt: string | null
      updatedByName: string | null
    }

export interface ActivationControls {
  /** The confirmation word the admin must type (enable or disable word). */
  word: string
  typed: string
  onTypedChange: (value: string) => void
  busy: boolean
  canEnable: boolean
  canDisable: boolean
  /** Pressed by the admin only. The caller re-checks the word and calls
   *  `set_roles_system_enabled`; nothing here toggles on its own. */
  onToggle: (next: boolean) => void
  result: { tone: NoticeTone; text: string } | null
  onDismissResult: () => void
}

export interface SystemSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: SystemStatus
  onRetryStatus?: () => void
  activation: ActivationControls
  offenders: Loaded<OffenderItem>
  preview: Loaded<PreviewUserItem>
  onRetryActivation?: () => void
  onFixOffender?: (offender: OffenderItem) => void
  log: {
    rows: ChangeItem[]
    loading?: boolean
    error?: boolean
    onRetry?: () => void
    canShowAll?: boolean
    onShowAll?: () => void
  }
  roleLabel: (roleKey: string | null) => string
}

/**
 * «اعدادات النظام»: the state of the roles system, the activation flow (who
 * blocks it, what changes for every user, the typed confirmation word and the
 * ONLY button that changes the flag) and the full change log of every role.
 */
export function SystemSettingsDialog({
  open,
  onOpenChange,
  status,
  onRetryStatus,
  activation,
  offenders,
  preview,
  onRetryActivation,
  onFixOffender,
  log,
  roleLabel,
}: SystemSettingsDialogProps) {
  const { t } = useI18n()
  const [showLog, setShowLog] = useState(false)
  const enabled = status.state === 'ready' ? status.enabled : null
  const offenderCount = offenders.state === 'ready' ? offenders.rows.length : 0
  const blocked =
    enabled === false && offenders.state === 'ready' && offenderCount > 0

  const offenderColumns: DataTableColumn<OffenderItem>[] = [
    {
      key: 'name',
      header: t('roleUsersColUser'),
      className: 'font-medium',
      cell: (row) => row.name,
    },
    {
      key: 'legacy',
      header: t('roleUsersColLegacy'),
      cell: (row) => row.legacyLabel,
      hideBelow: 'sm',
    },
    { key: 'role', header: t('roleUsersColNew'), cell: (row) => row.roleLabel },
    {
      key: 'reason',
      header: t('rolesColStatus'),
      cell: (row) => (
        <Badge size="sm" tone="danger">
          {row.reasonLabel}
        </Badge>
      ),
    },
    ...(onFixOffender
      ? [
          {
            key: 'fix',
            header: t('actions'),
            cell: (row: OffenderItem) => (
              <Button size="sm" onClick={() => onFixOffender(row)}>
                {t('rolesOffenderFix')}
              </Button>
            ),
          },
        ]
      : []),
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (activation.busy) return
        if (!next) setShowLog(false)
        onOpenChange(next)
      }}
      size="lg"
      title={t('rolesPageSystemSettings')}
      description={t('rolesPageSystemSettingsDesc')}
    >
      <div className="space-y-4">
        {status.state === 'loading' ? (
          <Skeleton className="h-20 w-full" />
        ) : status.state === 'error' ? (
          <ErrorState
            description={t('rolesSystemStatusLoadError')}
            onRetry={onRetryStatus}
          />
        ) : (
          <Notice
            tone={status.enabled ? 'success' : 'warning'}
            title={
              status.enabled
                ? t('rolesSystemActiveTitle')
                : t('rolesSystemInactiveTitle')
            }
            icon={
              status.enabled ? (
                <ShieldCheck size={18} aria-hidden="true" />
              ) : (
                <ShieldOff size={18} aria-hidden="true" />
              )
            }
          >
            <p>
              {status.enabled
                ? t('rolesSystemActiveBody')
                : t('rolesSystemInactiveBody')}
            </p>
            {(status.updatedAt || status.updatedByName) && (
              <p className="mt-1 text-xs">
                {[
                  status.updatedAt
                    ? fill(t('rolesSystemSince'), { date: status.updatedAt })
                    : null,
                  status.updatedByName
                    ? fill(t('rolesSystemChangedBy'), {
                        name: status.updatedByName,
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            )}
          </Notice>
        )}

        {activation.result && (
          <Notice
            tone={activation.result.tone}
            onDismiss={activation.onDismissResult}
          >
            {activation.result.text}
          </Notice>
        )}

        {enabled !== null && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-start gap-2">
              {enabled ? (
                <Ban
                  size={16}
                  aria-hidden="true"
                  className="mt-0.5 text-muted"
                />
              ) : (
                <Power
                  size={16}
                  aria-hidden="true"
                  className="mt-0.5 text-muted"
                />
              )}
              <div className="min-w-0 text-sm">
                <p className="font-semibold">
                  {enabled
                    ? t('rolesSystemStopTitle')
                    : t('rolesSystemStartTitle')}
                </p>
                <p className="text-xs text-muted">
                  {fill(
                    enabled
                      ? t('rolesSystemStopDesc')
                      : t('rolesSystemStartDesc'),
                    { word: activation.word },
                  )}
                </p>
              </div>
            </div>
            {blocked && (
              <Notice tone="warning" size="compact">
                {t('rolesEnableBlocked')}
              </Notice>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <Field
                label={t('rolesConfirmWordLabel')}
                name="roles_confirm"
                className="min-w-0 flex-1"
              >
                {(control) => (
                  <Input
                    {...control}
                    autoComplete="off"
                    spellCheck={false}
                    value={activation.typed}
                    disabled={
                      activation.busy ||
                      (enabled === false &&
                        (offenders.state !== 'ready' || offenderCount > 0))
                    }
                    placeholder={activation.word}
                    onChange={(event) =>
                      activation.onTypedChange(event.target.value)
                    }
                  />
                )}
              </Field>
              {enabled ? (
                <Button
                  variant="danger"
                  icon={<ShieldOff size={15} aria-hidden="true" />}
                  loading={activation.busy}
                  disabled={!activation.canDisable}
                  onClick={() => activation.onToggle(false)}
                >
                  {t('rolesActionDisable')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  icon={<ShieldCheck size={15} aria-hidden="true" />}
                  loading={activation.busy}
                  disabled={!activation.canEnable}
                  onClick={() => activation.onToggle(true)}
                >
                  {t('rolesActionEnable')}
                </Button>
              )}
            </div>
          </div>
        )}

        {enabled === false && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">
              {fill(t('rolesOffendersTitle'), {
                count: offenders.state === 'ready' ? offenderCount : '…',
              })}
            </h3>
            {offenders.state === 'error' ? (
              <ErrorState
                description={t('rolesActivationLoadError')}
                onRetry={onRetryActivation}
              />
            ) : offenders.state === 'ready' && offenderCount === 0 ? (
              <Notice tone="success" size="compact">
                {t('rolesOffendersNone')}
              </Notice>
            ) : (
              <DataTable
                size="sm"
                columns={offenderColumns}
                rows={offenders.state === 'ready' ? offenders.rows : []}
                rowKey={(row) => row.id}
                loading={offenders.state === 'loading'}
                loadingRows={3}
                caption={t('rolesOffendersTitle')}
              />
            )}
          </section>
        )}

        {enabled === false && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('rolesPreviewTitle')}</h3>
            <p className="text-xs text-muted">{t('rolesPreviewDesc')}</p>
            {preview.state === 'error' ? (
              <ErrorState
                description={t('rolesActivationLoadError')}
                onRetry={onRetryActivation}
              />
            ) : preview.state === 'loading' ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : preview.rows.length === 0 ? (
              <Notice tone="success" size="compact">
                {t('rolesPreviewNone')}
              </Notice>
            ) : (
              <ul className="space-y-2">
                {preview.rows.map((user) => (
                  <li key={user.id}>
                    <Card className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{user.name}</span>
                        <Badge size="sm" tone="neutral">
                          {user.legacyLabel}
                        </Badge>
                        <span className="text-muted" aria-hidden="true">
                          ←
                        </span>
                        <Badge size="sm" tone="info">
                          {user.roleLabel}
                        </Badge>
                      </div>
                      {user.gained.length > 0 && (
                        <PreviewLine
                          label={t('rolesPreviewGained')}
                          tone="success"
                          items={user.gained}
                        />
                      )}
                      {user.lost.length > 0 && (
                        <PreviewLine
                          label={t('rolesPreviewLost')}
                          tone="danger"
                          items={user.lost}
                        />
                      )}
                      {user.scopeChanged.length > 0 && (
                        <PreviewLine
                          label={t('rolesPreviewScopeChanged')}
                          tone="warning"
                          items={user.scopeChanged}
                        />
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ms-2 underline"
            aria-expanded={showLog}
            onClick={() => setShowLog((current) => !current)}
          >
            {showLog ? t('roleChangesHideFullLog') : t('roleChangesFullLog')}
          </Button>
          {showLog && (
            <ChangesTable
              rows={log.rows}
              roleLabel={roleLabel}
              loading={log.loading}
              error={log.error}
              onRetry={log.onRetry}
              canShowAll={log.canShowAll}
              onShowAll={log.onShowAll}
            />
          )}
        </div>
      </div>
    </Dialog>
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
      <Badge size="sm" tone={tone} className="w-fit">
        {label} ({items.length})
      </Badge>
      <p className="text-xs leading-relaxed">{items.join('، ')}</p>
    </div>
  )
}
