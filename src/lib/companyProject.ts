import type { Language } from '@/i18n/translations'

/**
 * The company / project fields the movement views (`movement_log_search`,
 * `movement_visits`) flatten onto each row. Workshop rows carry neither.
 */
export interface CompanyProjectSource {
  company_id?: string | null
  company_name_ar?: string | null
  company_name_en?: string | null
  project_id?: string | null
  project_name_ar?: string | null
  project_name_en?: string | null
}

function pickName(
  lang: Language,
  nameAr?: string | null,
  nameEn?: string | null,
): string | null {
  const preferred = lang === 'ar' ? nameAr : nameEn
  const fallback = lang === 'ar' ? nameEn : nameAr
  return preferred?.trim() || fallback?.trim() || null
}

/**
 * The two lines of the shared company / project table cell, in the interface
 * language with the other language as a fallback. A side is `null` when the
 * row has no such record (or the record has no name), so the cell can show
 * the one that exists, or its placeholder when neither does.
 *
 * Pure, so `tests/company-project-cell.test.cjs` can run it without React.
 */
export function companyProjectNames(
  lang: Language,
  row: CompanyProjectSource,
): { company: string | null; project: string | null } {
  return {
    company: row.company_id
      ? pickName(lang, row.company_name_ar, row.company_name_en)
      : null,
    project: row.project_id
      ? pickName(lang, row.project_name_ar, row.project_name_en)
      : null,
  }
}
