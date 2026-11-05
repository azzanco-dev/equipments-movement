import type { SupabaseClient } from '@supabase/supabase-js'
import type { TranslationKey } from '@/i18n/translations'
import { localizedName } from '@/lib/localizedName'
import { buildSearchFilter, COMPANY_PROJECT_SEARCH_FIELDS } from '@/lib/search'
import type { SelectOption } from '@/lib/selectOption'
import { unwrapRows } from '@/lib/supabaseResult'

/**
 * Settings › «اسنادات الفورمينات» (owner 2026-11-05, «ابدا في صفحة
 * الاسنادات»), over migration 0176: the companies a foreman is responsible
 * for (`profile_companies`, 0058) and, inside each, the projects he is
 * narrowed to (`profile_projects`; none = every project of that company).
 * Read through the security_invoker view `profile_assignments`, written in
 * ONE call of `admin_set_profile_assignments` (`users.manage`). The links
 * restrict only the company and project selectors of the movement form
 * (owner 2026-10-22, migration 0145); a foreman without links sees every
 * company and project.
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

/** One company of a foreman with its narrowed projects (empty = all). */
export interface CompanyAssignment {
  company: SelectOption
  projects: SelectOption[]
}

type Lang = 'ar' | 'en'

/** The view's rows of one foreman as the dialog's state, in the view's
 *  order of companies (by name) and projects (by name). */
export function assignmentsOf(
  rows: readonly ProfileAssignmentRow[],
  lang: Lang,
): CompanyAssignment[] {
  return [...rows]
    .sort((a, b) => a.company_name_ar.localeCompare(b.company_name_ar, 'ar'))
    .map((row) => ({
      company: {
        value: row.company_id,
        label: localizedName(lang, row.company_name_ar, row.company_name_en),
      },
      projects: row.project_ids.map((id, index) => ({
        value: id,
        label: localizedName(
          lang,
          row.project_names_ar[index] ?? '',
          row.project_names_en[index] ?? null,
        ),
      })),
    }))
}

/** The view's rows grouped by foreman. */
export function groupAssignments(
  rows: readonly ProfileAssignmentRow[],
): Map<string, ProfileAssignmentRow[]> {
  const groups = new Map<string, ProfileAssignmentRow[]>()
  for (const row of rows) {
    const list = groups.get(row.profile_id) ?? []
    list.push(row)
    groups.set(row.profile_id, list)
  }
  return groups
}

/** The arguments of `admin_set_profile_assignments`: every company, and
 *  the projects of the companies narrowed to some (duplicates once). */
export function assignmentPayload(
  profileId: string,
  assignments: readonly CompanyAssignment[],
): { p_profile_id: string; p_company_ids: string[]; p_project_ids: string[] } {
  const companies = Array.from(
    new Set(assignments.map((item) => item.company.value)),
  )
  const projects = Array.from(
    new Set(
      assignments.flatMap((item) =>
        item.projects.map((project) => project.value),
      ),
    ),
  )
  return {
    p_profile_id: profileId,
    p_company_ids: companies,
    p_project_ids: projects,
  }
}

/**
 * The companies picked in the dialog merged with the current state: a
 * company kept keeps its projects, a new one starts with all its projects
 * (none chosen), a removed one leaves with its projects.
 */
export function withCompanies(
  current: readonly CompanyAssignment[],
  companies: readonly SelectOption[],
): CompanyAssignment[] {
  const byId = new Map(current.map((item) => [item.company.value, item]))
  return companies.map(
    (company) => byId.get(company.value) ?? { company, projects: [] },
  )
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
  return 'saveFailed'
}

/** The projects of ONE company for its project picker: server-side search,
 *  20 at most, through the `company_projects` embed; throws on a failed
 *  read. */
export function companyProjectLoader(
  client: SupabaseClient,
  companyId: string,
  lang: Lang,
) {
  return async (query: string): Promise<SelectOption[]> => {
    let request = client
      .from('projects')
      .select('id,name_ar,name_en,company_projects!inner(company_id)')
      .eq('company_projects.company_id', companyId)
      .order('name_ar')
      .limit(20)
    const searchFilter = buildSearchFilter(COMPANY_PROJECT_SEARCH_FIELDS, query)
    if (searchFilter) request = request.or(searchFilter)
    return unwrapRows<{ id: string; name_ar: string; name_en: string | null }>(
      await request,
    ).map((project) => ({
      value: project.id,
      label: localizedName(lang, project.name_ar, project.name_en),
    }))
  }
}

/** The company picker of the dialog: server-side search, 20 at most. */
export function companyLoader(client: SupabaseClient, lang: Lang) {
  return async (query: string): Promise<SelectOption[]> => {
    let request = client
      .from('companies')
      .select('id,name_ar,name_en')
      .order('name_ar')
      .limit(20)
    const searchFilter = buildSearchFilter(COMPANY_PROJECT_SEARCH_FIELDS, query)
    if (searchFilter) request = request.or(searchFilter)
    return unwrapRows<{ id: string; name_ar: string; name_en: string | null }>(
      await request,
    ).map((company) => ({
      value: company.id,
      label: localizedName(lang, company.name_ar, company.name_en),
    }))
  }
}

/**
 * The movement form's project scope for one user (0176): the companies he
 * is linked to with no project narrowing (every project of theirs counts)
 * and the projects he is narrowed to elsewhere.
 */
export function projectScopeOf(rows: readonly ProfileAssignmentRow[]): {
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
