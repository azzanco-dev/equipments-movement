'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import type { TranslationKey } from '@/i18n/translations'
import { supabase } from '@/lib/supabase'
import {
  loadAfaqyUnits,
  runAfaqySync,
  type TrackerSyncConflictReason,
  type TrackerSyncReport,
} from '@/lib/afaqy'
import {
  Button,
  Card,
  ErrorState,
  InfoGrid,
  Notice,
  SectionHeader,
  Skeleton,
  cn,
} from '@/components/ui'

type Status =
  | { kind: 'checking' }
  | { kind: 'ok'; count: number }
  | { kind: 'not_configured' }
  | { kind: 'error' }

type SyncView =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; report: TrackerSyncReport }
  | { kind: 'error' }
  | { kind: 'not_configured' }

const CONFLICT_KEYS: Record<TrackerSyncConflictReason, TranslationKey> = {
  ambiguous_code: 'afaqyConflictAmbiguous',
  several_units: 'afaqyConflictSeveralUnits',
  equipment_linked_to_other_unit: 'afaqyConflictEquipmentLinked',
  unit_linked_elsewhere: 'afaqyConflictUnitLinked',
  update_failed: 'afaqyConflictUpdateFailed',
}

/**
 * wave 17 — Settings › «ربط افاقي (التتبع)» (admin only, like the whole
 * Settings page): the Afaqy connection status and the auto-link sync with
 * its report. Every request goes to our own admin-only routes; the browser
 * never sees an Afaqy credential.
 */
export function AfaqySettings() {
  const { t } = useI18n()
  const [status, setStatus] = useState<Status>({ kind: 'checking' })
  const [sync, setSync] = useState<SyncView>({ kind: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)

  const checkStatus = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus({ kind: 'checking' })
    const answer = await loadAfaqyUnits(supabase, controller.signal)
    if (!answer || controller.signal.aborted) return
    setStatus(
      answer.kind === 'ok'
        ? { kind: 'ok', count: answer.units.length }
        : { kind: answer.kind },
    )
  }, [])

  useEffect(() => {
    void checkStatus()
    return () => controllerRef.current?.abort()
  }, [checkStatus])

  const startSync = async () => {
    setSync({ kind: 'running' })
    const answer = await runAfaqySync(supabase)
    if (answer.kind === 'ok') {
      setSync({ kind: 'done', report: answer.report })
      setStatus({ kind: 'ok', count: answer.report.unitsTotal })
    } else {
      setSync({ kind: answer.kind })
      if (answer.kind === 'not_configured') setStatus(answer)
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Card className="space-y-4">
        <SectionHeader
          as="h2"
          title={t('afaqySettingsTitle')}
          description={t('afaqySettingsDesc')}
        />
        {status.kind === 'checking' ? (
          <div role="status" className="flex h-10 items-center">
            <Skeleton variant="text" className="w-56" />
            <span className="sr-only">{t('afaqyStatusChecking')}</span>
          </div>
        ) : status.kind === 'ok' ? (
          <Notice tone="success" size="compact">
            {t('afaqyStatusConfigured').replace(
              '{count}',
              String(status.count),
            )}
          </Notice>
        ) : status.kind === 'not_configured' ? (
          <Notice tone="neutral" size="compact">
            {t('afaqyStatusNotConfigured')}
          </Notice>
        ) : (
          <ErrorState
            title={t('afaqyStatusError')}
            onRetry={() => void checkStatus()}
            className="p-4"
          />
        )}

        <div className="space-y-2">
          <Button
            variant="primary"
            icon={<RefreshCw size={16} aria-hidden="true" />}
            loading={sync.kind === 'running'}
            disabled={
              status.kind === 'checking' || status.kind === 'not_configured'
            }
            onClick={() => void startSync()}
          >
            {t('afaqySyncButton')}
          </Button>
          <p className="text-xs text-muted">{t('afaqySyncHint')}</p>
        </div>

        {sync.kind === 'error' && (
          <Notice tone="danger">{t('afaqySyncFailed')}</Notice>
        )}
      </Card>

      {sync.kind === 'done' && <SyncReport report={sync.report} />}
    </div>
  )
}

function SyncReport({ report }: { report: TrackerSyncReport }) {
  const { t, lang } = useI18n()
  const count = (value: number) => (
    <span className="font-semibold tabular-nums">{value}</span>
  )
  return (
    <Card className="space-y-4">
      <SectionHeader as="h2" title={t('afaqySyncDone')} />
      <InfoGrid
        columns={3}
        items={[
          {
            key: 'units',
            label: t('afaqyReportUnits'),
            value: count(report.unitsTotal),
          },
          {
            key: 'linked',
            label: t('afaqyReportLinked'),
            value: count(report.linked),
          },
          {
            key: 'already',
            label: t('afaqyReportAlreadyLinked'),
            value: count(report.alreadyLinked),
          },
          {
            key: 'unmatched',
            label: t('afaqyReportUnmatched'),
            value: count(report.unmatchedUnits.length),
          },
          {
            key: 'without',
            label: t('afaqyReportWithoutUnit'),
            value: count(report.equipmentWithoutUnitTotal),
          },
          {
            key: 'failed',
            label: t('afaqyReportFailed'),
            value: count(report.failed),
          },
        ]}
      />

      <ReportList
        title={t('afaqyReportConflicts')}
        total={report.conflicts.length}
        rows={report.conflicts.map((conflict, index) => ({
          key: `${conflict.reason}-${conflict.unitId ?? index}-${index}`,
          primary: conflict.unitName ?? conflict.code ?? '—',
          secondary: [
            t(CONFLICT_KEYS[conflict.reason] ?? 'afaqyConflictUpdateFailed'),
            conflict.equipment
              .map((row) => row.code)
              .join(lang === 'ar' ? '، ' : ', '),
          ]
            .filter(Boolean)
            .join(' — '),
        }))}
        defaultOpen
      />
      <ReportList
        title={t('afaqyReportUnmatched')}
        total={report.unmatchedUnits.length}
        rows={report.unmatchedUnits.map((unit) => ({
          key: unit.unitId,
          primary: unit.name || '—',
          secondary: unit.code ?? t('afaqyReportNoCode'),
        }))}
      />
      <ReportList
        title={t('afaqyReportWithoutUnit')}
        total={report.equipmentWithoutUnitTotal}
        rows={report.equipmentWithoutUnit.map((row) => ({
          key: row.id,
          primary: row.code,
        }))}
      />
    </Card>
  )
}

interface ReportRow {
  key: string
  primary: string
  secondary?: string
}

/** A collapsible list of the report; closed by default except conflicts. */
function ReportList({
  title,
  total,
  rows,
  defaultOpen = false,
}: {
  title: string
  total: number
  rows: ReportRow[]
  defaultOpen?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(defaultOpen)
  if (total === 0) return null
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start text-sm text-fg hover:bg-surface-hover"
      >
        <span>
          {title} <span className="tabular-nums text-muted">({total})</span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn('shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="border-t px-3 py-2">
          <ul className="max-h-80 space-y-1.5 overflow-y-auto text-sm">
            {rows.map((row) => (
              <li key={row.key} className="flex flex-wrap gap-x-2">
                <span dir="ltr" className="text-fg">
                  {row.primary}
                </span>
                {row.secondary && (
                  <span className="text-muted">{row.secondary}</span>
                )}
              </li>
            ))}
          </ul>
          {total > rows.length && (
            <p className="mt-2 text-xs text-muted">
              {t('afaqyReportTruncated').replace(
                '{count}',
                String(rows.length),
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
