import type { ReactNode } from 'react'
import { Building2, Calendar, Hash, UserRound } from 'lucide-react'
import { useI18n } from '@/i18n/I18nContext'
import { cn } from '@/components/ui'
import { Skeleton } from '@/components/Spinner'
import { formatDate } from '@/lib/dateFormat'

export interface LastEntrySummaryProps {
  recordedAt?: string | Date | null
  driverName?: string | null
  driverMobile?: string | null
  contractorCode?: string | null
  companyName?: string | null
  projectName?: string | null
  loading?: boolean
  className?: string
}

function DefinitionItem({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <div className="min-w-0 leading-relaxed">
        <div className="text-xs text-muted">{label}</div>
        <div className="text-sm leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

function driverDisplay(
  driverName: string | null | undefined,
  driverMobile: string | null | undefined,
): ReactNode {
  const name = driverName?.trim() || null
  const mobile = driverMobile?.trim() || null

  if (!name && !mobile) return '—'

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span>{name ?? '—'}</span>
      {mobile ? (
        <a href={`tel:${mobile}`} dir="ltr" className="text-muted">
          {mobile}
        </a>
      ) : null}
    </span>
  )
}

function companyProjectDisplay(
  companyName: string | null | undefined,
  projectName: string | null | undefined,
): ReactNode {
  const company = companyName?.trim() || null
  const project = projectName?.trim() || null
  if (!company && !project) return '—'
  if (company && project) return `${company} - ${project}`
  return company ?? project
}

export function LastEntrySummary({
  recordedAt,
  driverName,
  driverMobile,
  contractorCode,
  companyName,
  projectName,
  loading = false,
  className,
}: LastEntrySummaryProps) {
  const { t } = useI18n()

  if (loading) {
    return (
      <div
        className={cn(
          'space-y-3 rounded-lg border border-border bg-surface p-4',
          className,
        )}
      >
        <Skeleton className="h-4 w-32" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'space-y-3 rounded-lg border border-border bg-surface p-4',
        className,
      )}
    >
      <p className="text-sm font-medium">{t('lastEntrySummaryTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <DefinitionItem
          icon={<Calendar size={16} />}
          label={t('entryDateTime')}
        >
          {recordedAt ? formatDate(recordedAt) : '—'}
        </DefinitionItem>
        <DefinitionItem
          icon={<UserRound size={16} />}
          label={t('driverAndMobile')}
        >
          {driverDisplay(driverName, driverMobile)}
        </DefinitionItem>
        <DefinitionItem
          icon={<Hash size={16} />}
          label={t('contractorEquipmentCode')}
        >
          {contractorCode?.trim() || '—'}
        </DefinitionItem>
        <DefinitionItem
          icon={<Building2 size={16} />}
          label={t('companyProjectLabel')}
        >
          {companyProjectDisplay(companyName, projectName)}
        </DefinitionItem>
      </div>
    </div>
  )
}
