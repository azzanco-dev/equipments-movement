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

/** The 0176 / 0212 tokens → safe messages. */
export function assignmentSaveMessage(error: {
  code?: string
  message?: string
}): TranslationKey {
  const text = error.message ?? ''
  // 0212: a caller who is not the admin never changes his own assignments
  // nor an admin's.
  if (text.includes('cannot_change_own_assignments'))
    return 'userAssignmentsOwnLocked'
  if (text.includes('admin_role_admin_only'))
    return 'userAssignmentsAdminLocked'
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

// ---------------------------------------------------------------------------
// Settings › «اسناد الشركات والمشاريع» (migration 0212, owner 2026-11-24:
// «نبغى نخلي اسنادات الشركات والمشاريع للمستخدمين مهمة منفصلة عن صفحة
// المستخدم، لانها ممكن تنسند لادوار غير الادمن»). The companies and projects
// are edited in ONE dialog, from that page and from the user page.
// ---------------------------------------------------------------------------

/** The key that opens the page without the whole «ادارة المستخدمين». */
export const USER_ASSIGNMENTS_PERMISSION = 'users.assignments'

/** Who may edit assignments at all: users.manage or users.assignments (the
 *  database's gate of `admin_set_profile_assignments`). */
export function canManageAssignments(can: (key: string) => boolean): boolean {
  return can('users.manage') || can(USER_ASSIGNMENTS_PERMISSION)
}

/**
 * Whether the caller may edit THIS user's assignments (the 0212 rule): the
 * admin edits anyone; anyone else never his own account (the companies widen
 * what a `movements.read` scope of `companies` reads) nor an admin's.
 */
export function assignmentsLockOf(input: {
  callerIsAdmin: boolean
  callerId: string | null | undefined
  targetId: string
  targetIsAdmin: boolean
}): 'own' | 'admin' | null {
  if (input.callerIsAdmin) return null
  if (input.callerId && input.callerId === input.targetId) return 'own'
  if (input.targetIsAdmin) return 'admin'
  return null
}

/** One linked company with its narrowed projects (empty = all of them): a
 *  row of `profile_assignments`, or an item of the view's `assignments`. */
export type AssignmentCompanyRow = Omit<ProfileAssignmentRow, 'profile_id'>

/** A company of the dialog's field: both names (relabelled when the
 *  language changes). */
export interface CompanyAssignmentOption extends SelectOption {
  name_ar: string
  name_en: string | null
}

/** One row of the view `user_assignment_list` (0212). */
export interface UserAssignmentListRow {
  id: string
  full_name: string
  role_key: string | null
  role_name_ar: string | null
  role_name_en: string | null
  records_projects: boolean
  company_ids: string[]
  has_assignments: boolean
  assignments: AssignmentCompanyRow[]
}

export const USER_ASSIGNMENT_LIST_SELECT =
  'id,full_name,role_key,role_name_ar,role_name_en,records_projects,company_ids,has_assignments,assignments'

/** A user's assignments as the dialog edits them. */
export interface UserAssignments {
  companies: CompanyAssignmentOption[]
  projects: ProjectOption[]
}

/** The dialog's starting values from the stored rows. */
export function assignmentsFromRows(
  rows: readonly AssignmentCompanyRow[],
  lang: Lang,
): UserAssignments {
  return {
    companies: rows.map((row) => ({
      value: row.company_id,
      label: localizedName(lang, row.company_name_ar, row.company_name_en),
      name_ar: row.company_name_ar,
      name_en: row.company_name_en,
    })),
    projects: assignedProjectsOf(
      rows.map((row) => ({ ...row, profile_id: '' })),
      lang,
    ),
  }
}

/** A stable key of an assignment set, to tell whether the dialog changed. */
export function assignmentsKey(value: UserAssignments): string {
  const ids = (items: readonly SelectOption[]) =>
    items
      .map((item) => item.value)
      .sort()
      .join(',')
  return `${ids(value.companies)}|${ids(value.projects)}`
}

/** The company field's options: server-side search, 20 at most; throws on a
 *  failed read so the control shows its load error. */
export function companyAssignmentLoader(client: SupabaseClient, lang: Lang) {
  return async (query: string): Promise<CompanyAssignmentOption[]> => {
    let request = client
      .from('companies')
      .select('id,name_ar,name_en')
      .order(lang === 'ar' ? 'name_ar' : 'name_en')
      .limit(20)
    const searchFilter = buildSearchFilter(COMPANY_PROJECT_SEARCH_FIELDS, query)
    if (searchFilter) request = request.or(searchFilter)
    return unwrapRows<{ id: string; name_ar: string; name_en: string | null }>(
      await request,
    ).map((company) => ({
      value: company.id,
      label: localizedName(lang, company.name_ar, company.name_en),
      name_ar: company.name_ar,
      name_en: company.name_en,
    }))
  }
}

/** The company filter of the page is the array `company_ids` (overlaps),
 *  applied by the screen, never by `applyListFilters`. */
export const USER_ASSIGNMENT_COLUMN_FILTERS: ReadonlySet<string> = new Set([
  'company_ids',
])

/** The ids an `in` filter value holds. */
export function filterIds(value: string): string[] {
  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

/** The rows a saved assignment set shows as (each company with its chosen
 *  projects, by name), so a screen updates without reading again. */
export function rowsFromAssignments(
  value: UserAssignments,
): AssignmentCompanyRow[] {
  return [...value.companies]
    .sort((a, b) => a.name_ar.localeCompare(b.name_ar, 'ar'))
    .map((company) => {
      const projects = value.projects
        .filter((project) => project.company_ids.includes(company.value))
        .sort((a, b) => a.name_ar.localeCompare(b.name_ar, 'ar'))
      return {
        company_id: company.value,
        company_name_ar: company.name_ar,
        company_name_en: company.name_en,
        project_ids: projects.map((project) => project.value),
        project_names_ar: projects.map((project) => project.name_ar),
        project_names_en: projects.map((project) => project.name_en),
      }
    })
}
