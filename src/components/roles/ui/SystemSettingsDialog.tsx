import { useState } from 'react'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { Button, Dialog, ErrorState, Notice, Skeleton } from '@/components/ui'
import { fill } from '../roleRows'
import { ChangesTable } from './ChangesTable'
import type { ChangeItem } from './model'

export type SystemStatus =
  | { state: 'loading' }
  | { state: 'error' }
  | {
      state: 'ready'
      enabled: boolean
      updatedAt: string | null
      updatedByName: string | null
    }

export interface SystemSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: SystemStatus
  onRetryStatus?: () => void
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
 * «اعدادات النظام»: the state of the roles system and the full change log of
 * every role. The system is on for good since 0150 (the owner enabled it on
 * 2026-10-12), and since roles stage 4c-2 (migration 0156) the legacy role
 * it once replaced is gone, so there is nothing left to activate or stop:
 * the activation flow (blockers, preview, confirmation word) was removed.
 */
export function SystemSettingsDialog({
  open,
  onOpenChange,
  status,
  onRetryStatus,
  log,
  roleLabel,
}: SystemSettingsDialogProps) {
  const { t } = useI18n()
  const [showLog, setShowLog] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
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
