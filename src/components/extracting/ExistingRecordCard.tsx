import { Badge } from '@/components/ui/Badge'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { Spinner } from '@/components/ui/Spinner'
import { useI18n } from '@/i18n/I18nContext'
import { UPDATE_FIELDS, type PublishTargets } from '@/lib/extracting/form'
import {
  hasExistingRecord,
  lookupEmployee,
  type LookupResult,
} from '@/lib/extracting/lookup'
import {
  errorMessageKey,
  FIELD_LABELS,
  TARGET_LABELS,
} from '@/lib/extracting/messages'
import type { LookupState } from './useExtraction'

interface ExistingRecordCardProps {
  lookup: LookupState
  targets: PublishTargets
}

function FoundRow({
  target,
  name,
  idLabel,
  id,
  extra,
}: {
  target: 'currentSystem' | 'erpnext'
  name: string
  idLabel: string
  id: string
  extra?: string
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <dt className="w-32 shrink-0 text-muted">{t(TARGET_LABELS[target])}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone="success">{t('extractingStatusExisting')}</Badge>
        <span dir="auto" className="font-medium">
          {name || '—'}
        </span>
        <span className="text-xs text-muted">
          {idLabel}: <span dir="ltr">{id}</span>
        </span>
        {extra ? (
          <span className="text-xs text-muted" dir="ltr">
            {extra}
          </span>
        ) : null}
      </dd>
    </div>
  )
}

function NotFoundRow({
  target,
  message,
}: {
  target: 'currentSystem' | 'erpnext'
  message: string
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <dt className="w-32 shrink-0 text-muted">{t(TARGET_LABELS[target])}</dt>
      <dd className="text-muted">{message}</dd>
    </div>
  )
}

function LookupRows({ result }: { result: LookupResult }) {
  const { t } = useI18n()
  const driver = result.currentSystem
  const employee = lookupEmployee(result)
  const erp = result.erpnext
  return (
    <dl className="space-y-2 text-sm">
      {driver ? (
        <FoundRow
          target="currentSystem"
          name={driver.full_name}
          idLabel={t('extractingLookupDriverId')}
          id={driver.id.slice(0, 8)}
          extra={driver.mobile_number ?? undefined}
        />
      ) : (
        <NotFoundRow
          target="currentSystem"
          message={t('extractingLookupNoneInTarget')}
        />
      )}
      {!erp.configured ? (
        <NotFoundRow
          target="erpnext"
          message={t('extractingLookupErpNotConfigured')}
        />
      ) : 'error' in erp ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <dt className="w-32 shrink-0 text-muted">
            {t(TARGET_LABELS.erpnext)}
          </dt>
          <dd className="text-danger">{t(errorMessageKey(erp.error))}</dd>
        </div>
      ) : employee ? (
        <FoundRow
          target="erpnext"
          name={employee.employee_name}
          idLabel={t('extractingLookupEmployeeId')}
          id={employee.name}
          extra={employee.user_id || undefined}
        />
      ) : (
        <NotFoundRow
          target="erpnext"
          message={t('extractingLookupNoneInTarget')}
        />
      )}
    </dl>
  )
}

/**
 * What already exists for the reviewed residence number in each publish
 * target, and whether the caller may update it. Shown while the fields are
 * under review; the lookup itself runs in `useExtraction`.
 */
export function ExistingRecordCard({
  lookup,
  targets,
}: ExistingRecordCardProps) {
  const { t } = useI18n()
  if (lookup.status === 'idle') return null

  const result = lookup.status === 'ready' ? lookup.result : null
  const found = !!result && (!!result.currentSystem || !!lookupEmployee(result))
  const updatable = !!result && hasExistingRecord(result, targets)

  return (
    <Card as="section" className="space-y-3">
      <SectionHeader
        as="h2"
        title={t('extractingLookupSection')}
        description={t('extractingLookupDescription')}
      />
      {lookup.status === 'loading' ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner size="sm" label={t('extractingLookupLoading')} />
          {t('extractingLookupLoading')}
        </p>
      ) : null}
      {lookup.status === 'error' ? (
        <Notice tone="danger" size="compact">
          {t(lookup.message)}
        </Notice>
      ) : null}
      {result ? (
        found ? (
          <LookupRows result={result} />
        ) : (
          <p className="text-sm text-muted">{t('extractingLookupNone')}</p>
        )
      ) : null}
      {result && found && !result.canUpdate ? (
        <Notice tone="info" size="compact">
          {t('extractingLookupAdminOnly')}
        </Notice>
      ) : null}
      {result && updatable && result.canUpdate ? (
        <Notice tone="warning" size="compact">
          {t('extractingUpdateNotice')}{' '}
          <span className="font-medium">
            {UPDATE_FIELDS.map((key) => t(FIELD_LABELS[key])).join('، ')}
          </span>
          <span className="mt-1 block text-xs opacity-80">
            {t('extractingUpdateNoticeSuffix')}
          </span>
        </Notice>
      ) : null}
    </Card>
  )
}
