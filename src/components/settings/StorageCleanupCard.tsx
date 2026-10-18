'use client'

import { useState } from 'react'
import { useI18n } from '@/i18n/I18nContext'
import { usePermissions } from '@/auth/PermissionsContext'
import { callEdgeFunction, EdgeFunctionError } from '@/lib/edgeFunction'
import {
  Button,
  Card,
  InfoGrid,
  Notice,
  SectionHeader,
  useConfirm,
} from '@/components/ui'

// Audit run-1 (2026-10-18), lead B-9 — Settings › «تنظيف ملفات الصور»: the
// orphan cleanup of the `log-photos` bucket through the Edge Function
// `storage-cleanup`. The card exists only for a holder of
// `movements.photos.delete_any` (the function re-checks the same key as the
// caller). «فحص» is a dry run that only counts; «تنظيف» deletes after a
// confirmation and is offered only after a check that found something.

export type StorageCleanupReport = {
  dry_run: true
  older_than_hours: number
  total_objects: number
  orphan_objects: number
  orphan_bytes: number
  expired_batches: number
  folders: { folder: string; objects: number; bytes: number }[]
}

export type StorageCleanupResult = {
  dry_run: false
  older_than_hours: number
  deleted_objects: number
  freed_bytes: number
  deleted_batches: number
}

type View =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'checked'; report: StorageCleanupReport }
  | { kind: 'cleaning'; report: StorageCleanupReport }
  | { kind: 'cleaned'; result: StorageCleanupResult }

const MEGABYTE = 1024 * 1024

export function StorageCleanupCard() {
  const { t } = useI18n()
  const { can } = usePermissions()
  const { confirm, confirmDialog } = useConfirm()
  const [view, setView] = useState<View>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)

  if (!can('movements.photos.delete_any')) return null

  const megabytes = (bytes: number) =>
    t('storageCleanupMegabytes').replace(
      '{value}',
      (bytes / MEGABYTE).toFixed(1),
    )

  const describeError = (failure: unknown) => {
    if (!(failure instanceof EdgeFunctionError))
      return t('storageCleanupFailed')
    if (failure.code === 'network') return t('networkConnectionError')
    if (failure.code === 'sessionExpired') return t('sessionExpiredError')
    if (failure.code === 'forbidden') return t('storageCleanupForbidden')
    if (
      failure.serverCode === 'remove_failed' ||
      failure.serverCode === 'batches_failed'
    )
      return t('storageCleanupPartial')
    return t('storageCleanupFailed')
  }

  const check = async () => {
    setError(null)
    setView({ kind: 'checking' })
    try {
      const report = await callEdgeFunction<StorageCleanupReport>(
        'storage-cleanup',
        { dry_run: true },
      )
      setView({ kind: 'checked', report })
    } catch (failure) {
      setError(describeError(failure))
      setView({ kind: 'idle' })
    }
  }

  const clean = async (report: StorageCleanupReport) => {
    const confirmed = await confirm({
      title: t('storageCleanupConfirmTitle'),
      description: t('storageCleanupConfirmDesc')
        .replace('{objects}', String(report.orphan_objects))
        .replace('{size}', megabytes(report.orphan_bytes))
        .replace('{batches}', String(report.expired_batches)),
      confirmLabel: t('storageCleanupRun'),
      tone: 'danger',
    })
    if (!confirmed) return
    setError(null)
    setView({ kind: 'cleaning', report })
    try {
      const result = await callEdgeFunction<StorageCleanupResult>(
        'storage-cleanup',
        { dry_run: false, older_than_hours: report.older_than_hours },
      )
      setView({ kind: 'cleaned', result })
    } catch (failure) {
      setError(describeError(failure))
      // After a failed or partial run the counts are stale: check again.
      setView({ kind: 'idle' })
    }
  }

  const report =
    view.kind === 'checked' || view.kind === 'cleaning' ? view.report : null
  const busy = view.kind === 'checking' || view.kind === 'cleaning'
  const hasWork =
    !!report && (report.orphan_objects > 0 || report.expired_batches > 0)

  return (
    <Card className="space-y-4">
      <SectionHeader
        as="h2"
        title={t('storageCleanupTitle')}
        description={t('storageCleanupDesc')}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void check()}
            disabled={busy}
          >
            {view.kind === 'checking'
              ? t('storageCleanupChecking')
              : t('storageCleanupCheck')}
          </Button>
        }
      />
      <p className="text-xs text-muted">{t('storageCleanupHint')}</p>
      {error && (
        <Notice tone="danger" size="compact">
          {error}
        </Notice>
      )}
      {report && (
        <>
          <InfoGrid
            columns={2}
            items={[
              {
                key: 'total',
                label: t('storageCleanupTotalObjects'),
                value: report.total_objects,
                numeric: true,
              },
              {
                key: 'orphans',
                label: t('storageCleanupOrphans'),
                value: report.orphan_objects,
                numeric: true,
              },
              {
                key: 'bytes',
                label: t('storageCleanupOrphanBytes'),
                value: megabytes(report.orphan_bytes),
                numeric: true,
              },
              {
                key: 'folders',
                label: t('storageCleanupFolders'),
                value: report.folders.length,
                numeric: true,
              },
              {
                key: 'batches',
                label: t('storageCleanupExpiredBatches'),
                value: report.expired_batches,
                numeric: true,
              },
            ]}
          />
          {hasWork ? (
            <div className="flex justify-end">
              <Button
                variant="danger"
                size="sm"
                onClick={() => void clean(report)}
                disabled={busy}
              >
                {view.kind === 'cleaning'
                  ? t('storageCleanupRunning')
                  : t('storageCleanupRun')}
              </Button>
            </div>
          ) : (
            <Notice tone="success" size="compact">
              {t('storageCleanupNothing')}
            </Notice>
          )}
        </>
      )}
      {view.kind === 'cleaned' && (
        <Notice tone="success" size="compact" title={t('storageCleanupDone')}>
          <InfoGrid
            columns={3}
            items={[
              {
                key: 'deleted',
                label: t('storageCleanupDeletedObjects'),
                value: view.result.deleted_objects,
                numeric: true,
              },
              {
                key: 'freed',
                label: t('storageCleanupFreed'),
                value: megabytes(view.result.freed_bytes),
                numeric: true,
              },
              {
                key: 'batches',
                label: t('storageCleanupDeletedBatches'),
                value: view.result.deleted_batches,
                numeric: true,
              },
            ]}
          />
        </Notice>
      )}
      {confirmDialog}
    </Card>
  )
}
