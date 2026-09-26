import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Card, SectionHeader } from '@/components/ui/Card'
import { useI18n } from '@/i18n/I18nContext'
import type {
  PublishStatus,
  PublishTarget,
  TargetPublishResult,
} from '@/lib/extracting/form'
import {
  errorMessageKey,
  STATUS_LABELS,
  TARGET_LABELS,
} from '@/lib/extracting/messages'

const STATUS_TONES: Record<PublishStatus, BadgeTone> = {
  created: 'success',
  existing: 'info',
  partial: 'warning',
  skipped: 'neutral',
  failed: 'danger',
}

function StatusBadge({ status }: { status: PublishStatus }) {
  const { t } = useI18n()
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'}>
      {STATUS_LABELS[status] ? t(STATUS_LABELS[status]) : status}
    </Badge>
  )
}

interface PublishResultCardProps {
  target: PublishTarget
  result: TargetPublishResult
}

export function PublishResultCard({ target, result }: PublishResultCardProps) {
  const { t } = useI18n()
  return (
    <Card as="article" className="space-y-3">
      <SectionHeader
        as="h2"
        title={t(TARGET_LABELS[target])}
        action={<StatusBadge status={result.status} />}
      />
      {result.steps ? (
        <dl className="space-y-2 text-sm">
          {(
            [
              ['extractingStepUser', result.steps.user],
              ['extractingStepEmployee', result.steps.employee],
            ] as const
          ).map(([label, status]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3"
            >
              <dt className="text-muted">{t(label)}</dt>
              <dd>
                <StatusBadge status={status} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {result.error ? (
        <p className="text-sm text-danger">
          {t(errorMessageKey(result.error))}
        </p>
      ) : null}
      {result.details ? (
        <p
          dir="auto"
          className="break-words rounded-lg border border-danger bg-danger-soft p-2 text-sm text-danger"
        >
          {result.details}
        </p>
      ) : null}
    </Card>
  )
}
