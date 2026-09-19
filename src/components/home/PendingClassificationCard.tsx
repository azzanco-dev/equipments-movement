import { Badge, Select, Skeleton } from '@/components/ui'
import { Card, SectionHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { useI18n } from '@/i18n/I18nContext'
import { formatDate } from '@/lib/dateFormat'
import type { PendingClassificationEntry } from '@/lib/homeStats'

export interface PendingClassificationCardProps {
  rows: PendingClassificationEntry[]
  loading: boolean
  error: boolean
  onRetry: () => void
  /** Only `assistant_workshop_manager` / `workshop_manager` may classify. */
  canClassify: boolean
  onClassify: (entryLogId: string, purpose: string) => void
  classifyingId: string | null
  /** Safe message shown when the classification call failed. */
  classifyError: string | null
}

/**
 * Workshop entries that are still open and have no purpose yet — the first
 * thing the workshop roles see. `workshop` users get a read-only badge; the
 * managers get the classification control, and the database function
 * `classify_workshop_entry` remains the authority either way.
 */
export function PendingClassificationCard({
  rows,
  loading,
  error,
  onRetry,
  canClassify,
  onClassify,
  classifyingId,
  classifyError,
}: PendingClassificationCardProps) {
  const { t } = useI18n()

  return (
    <Card className="space-y-3">
      <SectionHeader
        as="h2"
        title={t('awaitingClassification')}
        description={t('awaitingClassificationDesc')}
      />
      {classifyError && (
        <p
          role="alert"
          className="rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {classifyError}
        </p>
      )}
      {error ? (
        <ErrorState onRetry={onRetry} />
      ) : loading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={t('noPendingClassification')} />
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-fg">
                  {row.equipmentCode}
                </span>
                <span className="truncate-safe block text-xs text-muted">
                  {row.equipmentType} · {formatDate(row.recordedAt)}
                </span>
              </span>
              {canClassify ? (
                <Select
                  value=""
                  onValueChange={(value) => onClassify(row.id, value)}
                  disabled={classifyingId === row.id}
                  placeholder={t('selectClassification')}
                  aria-label={`${t('selectClassification')} — ${row.equipmentCode}`}
                  className="w-40"
                  options={[
                    { value: 'maintenance', label: t('maintenancePurpose') },
                    { value: 'parking', label: t('parkingPurpose') },
                  ]}
                />
              ) : (
                <Badge tone="warning">{t('awaitingClassification')}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
