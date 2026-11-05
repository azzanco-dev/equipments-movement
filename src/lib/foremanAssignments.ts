import type { SupabaseClient } from '@supabase/supabase-js'
import type { TranslationKey } from '@/i18n/translations'
import { localizedName } from '@/lib/localizedName'
import { buildSearchFilter, COMPANY_PROJECT_SEARCH_FIELDS } from '@/lib/search'
import type { SelectOption } from '@/lib/selectOption'
import { unwrapRows } from '@/lib/supabaseResult'

/**
 * A foreman's companies and projects (migration 0176). The companies he is
 * responsible for (`profile_companies`, 0058) may each be narrowed to some
 * of their projects (`profile_projects`; none = every project of that
 * company). Read through the security_invoker view `profile_assignments`,
 * written in ONE call of `admin_set_profile_assignments` (`users.manage`).
 * Edited on the user page beside «الشركات المسؤول عنها» (owner 2026-11-05:
 * «مانحتاج صفحة الاسنادات … حقل ثاني مشابه للشركات, والقائمة الي فيه هي
 * المشاريع الي في الشركات المسنودة»). The links restrict only the company
 * and project selectors of the movement form (owner 2026-10-22, 0145).
 */

/** One row of the view `profile_assignments` (0176). */
export interface ProfileAssignmentRow {
  profile_id: string
  company_id: string
  company_name_ar: string
  company_name_en: string | null
  project_ids: string[]
  project_names_ar: string[]
  project_names_en: (string | null)[]
}

export const PROFILE_ASSIGNMENTS_SELECT =
  'profile_id,company_id,company_name_ar,company_name_en,project_ids,project_names_ar,project_names_en'

type Lang = 'ar' | 'en'

/** A project of the user page's field: both names (relabelled when the
 *  language changes) and the chosen companies it belongs to. */
export interface ProjectOption extends SelectOption {
  name_ar: string
  name_en: string | null
  company_ids: string[]
}

/** The projects the user is narrowed to, from his view rows. */
export function assignedProjectsOf(
  rows: readonly ProfileAssignmentRow[],
  lang: Lang,
): ProjectOption[] {
  const byId = new Map<string, ProjectOption>()
  for (const row of rows)
    row.project_ids.forEach((id, index) => {
      const known = byId.get(id)
      if (known) {
        known.company_ids.push(row.company_id)
        return
      }
      const nameAr = row.project_names_ar[index] ?? ''
      const nameEn = row.project_names_en[index] ?? null
      byId.set(id, {
        value: id,
        label: localizedName(lang, nameAr, nameEn),
        name_ar: nameAr,
        name_en: nameEn,
        company_ids: [row.company_id],
      })
    })
  return Array.from(byId.values()).sort((a, b) =>
    a.name_ar.localeCompare(b.name_ar, 'ar'),
  )
}

/** The chosen projects that still belong to one of the chosen companies
 *  (a company taken off the field takes its projects with it). */
export function projectsWithinCompanies(
  projects: readonly ProjectOption[],
  companyIds: readonly string[],
): ProjectOption[] {
  const companies = new Set(companyIds)
  return projects.filter((project) =>
    project.company_ids.some((id) => companies.has(id)),
  )
}

/** The project field's options: the projects of the chosen companies,
 *  server-side search through the `company_projects` embed, 20 at most;
 *  throws on a failed read so the control shows its load error. */
export function companiesProjectLoader(
  client: SupabaseClient,
  companyIds: readonly string[],
  lang: Lang,
) {
  return async (query: string): Promise<ProjectOption[]> => {
    if (!companyIds.length) return []
    let request = client
      .from('projects')
      .select('id,name_ar,name_en,company_projects!inner(company_id)')
      .in('company_projects.company_id', Array.from(companyIds))
      .order('name_ar')
      .limit(20)
    const searchFilter = buildSearchFilter(COMPANY_PROJECT_SEARCH_FIELDS, query)
    if (searchFilter) request = request.or(searchFilter)
    return unwrapRows<{
      id: string
      name_ar: string
      name_en: string | null
      company_projects: { company_id: string }[]
    }>(await request).map((project) => ({
      value: project.id,
      label: localizedName(lang, project.name_ar, project.name_en),
      name_ar: project.name_ar,
      name_en: project.name_en,
      company_ids: project.company_projects.map((link) => link.company_id),
    }))
  }
}

/** The 0176 tokens → safe messages. */
export function assignmentSaveMessage(error: {
  code?: string
  message?: string
}): TranslationKey {
  const text = error.message ?? ''
  if (text.includes('users_manage_required') || error.code === '42501')
    return 'foremanAssignmentsNotAllowed'
  if (text.includes('project_company_not_assigned'))
    return 'foremanAssignmentsProjectOutside'
  if (/invalid_(profile|company|project)/.test(text))
    return 'foremanAssignmentsStale'
  return 'userProjectsSaveFailed'
}

/**
 * The movement form's project scope for one user (0176): the companies he
 * is linked to with no project narrowing (every project of theirs counts)
 * and the projects he is narrowed to elsewhere.
 */
export function projectScopeOf(
  rows: readonly Pick<ProfileAssignmentRow, 'company_id' | 'project_ids'>[],
): {
  wholeCompanyIds: string[]
  projectIds: string[]
} {
  return {
    wholeCompanyIds: rows
      .filter((row) => row.project_ids.length === 0)
      .map((row) => row.company_id),
    projectIds: Array.from(new Set(rows.flatMap((row) => row.project_ids))),
  }
}
