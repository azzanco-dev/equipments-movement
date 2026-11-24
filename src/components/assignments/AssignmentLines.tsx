import { Badge } from '@/components/ui'
import { useI18n } from '@/i18n/I18nContext'
import type { AssignmentCompanyRow } from '@/lib/foremanAssignments'
import { localizedName } from '@/lib/localizedName'

/**
 * A user's assignments as the approved design shows them (migration 0212):
 * one line per linked company — its name as a small badge, then its narrowed
 * projects, or «كل المشاريع» when none is picked —, and «بدون اسناد» with
 * «يختار من كل الشركات والمشاريع» under it when the user has none. Used by
 * Settings › «اسناد الشركات والمشاريع» and the user page.
 */
export function AssignmentLines({
  rows,
  compact = false,
  divided = false,
}: {
  rows: readonly AssignmentCompanyRow[]
  /** 13 px text (the list's table); the user page keeps 14 px. */
  compact?: boolean
  /** A thin line between the companies (the Settings page's side panel). */
  divided?: boolean
}) {
  const { t, lang } = useI18n()
  const text = compact ? 'text-[13px]' : 'text-sm'
  if (rows.length === 0)
    return (
      <span className="flex flex-col gap-0.5 text-start">
        <span className={`${text} text-muted`}>{t('userAssignmentsNone')}</span>
        <span className="text-xs text-placeholder">
          {t('userAssignmentsNoneHint')}
        </span>
      </span>
    )
  return (
    <span
      className={`flex flex-col text-start ${divided ? 'divide-y' : 'gap-1.5'}`}
    >
      {rows.map((row) => {
        const projects = row.project_ids.map((_, index) =>
          localizedName(
            lang,
            row.project_names_ar[index] ?? '',
            row.project_names_en[index] ?? null,
          ),
        )
        return (
          <span
            key={row.company_id}
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${divided ? 'py-2.5 first:pt-0 last:pb-0' : ''}`}
          >
            <Badge
              tone="neutral"
              size="sm"
              className="max-w-full !shrink !whitespace-normal break-words"
            >
              {localizedName(lang, row.company_name_ar, row.company_name_en)}
            </Badge>
            {projects.length > 0 ? (
              <span className={text}>{projects.join('، ')}</span>
            ) : (
              <span className={`${text} text-muted`}>
                {t('userAssignmentsAllProjects')}
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}
