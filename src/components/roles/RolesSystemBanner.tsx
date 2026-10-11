'use client'

import { ShieldCheck, ShieldOff } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { formatDateTime } from '@/lib/dateFormat'
import { Button, Notice, Skeleton } from '@/components/ui'
import { fill } from './roleRows'

export interface RolesSystemFlag {
  enabled: boolean
  /** `app_settings.updated_at` of the flag row: when it last changed. */
  updatedAt: string | null
  updatedByName: string | null
}

/**
 * The status banner at the top of the roles page. Read-only: the only control
 * that changes the flag is the activation panel («التفعيل» tab).
 */
export function RolesSystemBanner({
  flag,
  failed,
  onRetry,
}: {
  flag: RolesSystemFlag | null
  failed: boolean
  onRetry: () => void
}) {
  const { t } = useI18n()
  if (failed)
    return (
      <Notice
        tone="danger"
        action={
          <Button size="sm" onClick={onRetry}>
            {t('retry')}
          </Button>
        }
      >
        {t('rolesSystemStatusLoadError')}
      </Notice>
    )
  if (!flag) return <Skeleton className="h-16 w-full" />

  const when = flag.updatedAt
    ? fill(t('rolesSystemSince'), { date: formatDateTime(flag.updatedAt) })
    : null
  const who = flag.updatedByName
    ? fill(t('rolesSystemChangedBy'), { name: flag.updatedByName })
    : null

  if (flag.enabled)
    return (
      <Notice
        tone="success"
        icon={<ShieldCheck size={18} aria-hidden="true" />}
        title={t('rolesSystemActiveTitle')}
      >
        <p>{t('rolesSystemActiveBody')}</p>
        {(when || who) && (
          <p className="mt-1 text-xs">
            {[when, who].filter(Boolean).join(' ')}
          </p>
        )}
      </Notice>
    )

  return (
    <Notice
      tone="warning"
      icon={<ShieldOff size={18} aria-hidden="true" />}
      title={t('rolesSystemInactiveTitle')}
    >
      <p>{t('rolesSystemInactiveBody')}</p>
      {/* Only after an admin deactivated it; the seeded row has no author. */}
      {who && when && (
        <p className="mt-1 text-xs">
          {when} {who}
        </p>
      )}
    </Notice>
  )
}
