import { useI18n } from '@/i18n/I18nContext'
import {
  companyProjectNames,
  type CompanyProjectSource,
} from '@/lib/companyProject'

export interface CompanyProjectCellProps {
  /** A `movement_log_search` / `movement_visits` row (or the same fields). */
  row: CompanyProjectSource
}

/**
 * The one "company / project" cell of the visits and movement log tables
 * (owner request 2026-09-30): the company on the first line in the table's
 * own text style, the project under it in smaller, lighter text.
 *
 * - Only one of the two: that one alone, on a single line.
 * - Neither (every workshop row): the muted dash used across the tables.
 *
 * Long names are cut with an ellipsis and keep the full name in `title`. The
 * two lines are 21 px + 18 px (`truncate-safe` sets the roomier line-height
 * Arabic glyphs need), so the cell fits the 44 px visits rows and the 40 px
 * log rows without making a two-line row taller than a one-line one.
 */
export function CompanyProjectCell({ row }: CompanyProjectCellProps) {
  const { lang } = useI18n()
  const { company, project } = companyProjectNames(lang, row)
  const primary = company ?? project
  if (!primary) return <span className="text-muted">—</span>
  const secondary = company ? project : null
  return (
    <span className="flex max-w-[14rem] flex-col text-start">
      <span className="truncate-safe" title={primary}>
        {primary}
      </span>
      {secondary && (
        <span className="truncate-safe text-xs text-muted" title={secondary}>
          {secondary}
        </span>
      )}
    </span>
  )
}
