import { Button, Tabs, TabsList, TabsTrigger, cn } from '@/components/ui'
import { OwnerFilter } from '@/components/admin-home/OwnerFilter'
import { useI18n } from '@/i18n/I18nContext'
import type { AdminHomeOwner } from '@/lib/adminHomeStats'
import {
  isAlazaniOnly,
  parseReportOwners,
  toggleAlazaniOnly,
  type ReportContext,
} from '@/lib/reportFilters'
import type { TranslationKey } from '@/i18n/translations'

const CONTEXT_LABEL: Record<ReportContext, TranslationKey> = {
  site: 'reportContextSite',
  workshop: 'reportContextWorkshop',
  all: 'reportContextAll',
}

const CONTEXTS: ReportContext[] = ['site', 'workshop', 'all']

export interface OwnerContextFilterProps {
  /** An empty array means every owner, never "no owners". */
  owners: string[]
  onOwnersChange: (owners: AdminHomeOwner[]) => void
  /** Only read when `showContext` is on; `site` is the reports' default. */
  context?: ReportContext
  onContextChange?: (context: ReportContext) => void
  /** The equipment report has one context only, so it hides the tabs. */
  showContext?: boolean
  className?: string
}

/**
 * The report filter bar: owner classification plus, where a report spans both
 * movement contexts, the site / workshop / all tabs.
 *
 * Both values are applied server-side by the caller (`p_owners` and
 * `p_context`, or a PostgREST filter) and persisted in the URL, so this
 * component holds no state of its own.
 *
 * The «العزاني فقط» shortcut is not a sixth option: it writes the ordinary
 * one-owner selection `['alazani']` that the multi-select shows, and pressing
 * it again clears back to every owner. That way the two controls can never
 * disagree about what is filtered.
 */
export function OwnerContextFilter({
  owners,
  onOwnersChange,
  context = 'site',
  onContextChange,
  showContext = false,
  className,
}: OwnerContextFilterProps) {
  const { t } = useI18n()
  const value = parseReportOwners(owners)
  const alazaniOnly = isAlazaniOnly(value)

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <OwnerFilter
        size="sm"
        value={value}
        onChange={onOwnersChange}
        className="w-36 sm:w-44"
      />
      <Button
        size="sm"
        variant="outline"
        aria-pressed={alazaniOnly}
        className={
          alazaniOnly ? 'border-fg bg-surface-hover font-medium' : undefined
        }
        onClick={() => onOwnersChange(toggleAlazaniOnly(value))}
      >
        {t('reportFilterAlazaniOnly')}
      </Button>
      {showContext && (
        <Tabs
          value={context}
          onValueChange={(next) => onContextChange?.(next as ReportContext)}
        >
          <TabsList variant="segmented" aria-label={t('reportContextFilter')}>
            {CONTEXTS.map((option) => (
              <TabsTrigger key={option} value={option}>
                {t(CONTEXT_LABEL[option])}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
    </div>
  )
}
