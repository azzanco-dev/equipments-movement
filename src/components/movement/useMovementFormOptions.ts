import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import { driverOption } from '@/lib/driverOptions'
import { localizedName } from '@/lib/localizedName'
import {
  buildSearchFilter,
  COMPANY_PROJECT_SEARCH_FIELDS,
  DRIVER_SEARCH_FIELDS,
  NAME_SEARCH_FIELDS,
} from '@/lib/search'
import { unwrapRows } from '@/lib/supabaseResult'
import {
  projectScopeOf,
  type ProfileAssignmentRow,
} from '@/lib/foremanAssignments'

/** The project columns the selector reads. */
type ProjectRow = { id: string; name_ar: string; name_en: string | null }

export interface MovementFormOptionLoaders {
  loadDrivers: (query: string) => Promise<AsyncSearchSelectOption[]>
  loadCompanies: (query: string) => Promise<AsyncSearchSelectOption[]>
  loadProjects: (query: string) => Promise<AsyncSearchSelectOption[]>
  loadEquipmentTypes: (query: string) => Promise<AsyncSearchSelectOption[]>
  loadLessors: (query: string) => Promise<AsyncSearchSelectOption[]>
}

/**
 * Server-side searched options for the movement form selectors. Every loader
 * returns at most 20 rows and selects only the columns the option needs, so a
 * selector never loads a full table into the browser.
 *
 * `userId` (the signed-in user, passed by the form: the movement components
 * read no auth context themselves, wave 24) narrows the company and project
 * selectors to his linked companies; without it nothing is narrowed.
 */
export function useMovementFormOptions({
  userId = null,
}: { userId?: string | null } = {}): MovementFormOptionLoaders {
  const { lang } = useI18n()
  // Owner 2026-10-22: the company and project selectors offer only the
  // companies linked to the user on his page («الشركات المسؤول عنها»,
  // profile_companies, 0058) and the projects company_projects links to
  // them; a user without links (the admin, the workshop roles) gets every
  // company and project. The links restrict nothing else (migration 0145).
  // Read once through RLS (the user's own rows); a failed read filters
  // nothing rather than hiding the lists. Owner 2026-10-22 (option 2): when
  // none of his companies is linked to a project yet, the project selector
  // falls back to every project, so the entry can still be recorded.
  //
  // Migration 0176 (owner 2026-11-05, Settings › «اسنادات الفورمينات»): a
  // linked company may be narrowed to some of its projects
  // (`profile_projects`); read through `profile_assignments`, a company with
  // no project rows still offers every project of its own.
  const [assignedCompanyIds, setAssignedCompanyIds] = useState<string[]>([])
  const [wholeCompanyIds, setWholeCompanyIds] = useState<string[]>([])
  const [assignedProjectIds, setAssignedProjectIds] = useState<string[]>([])
  const [hasLinkedProjects, setHasLinkedProjects] = useState(false)
  useEffect(() => {
    if (!userId) return
    let active = true
    const load = async () => {
      const { data } = await supabase
        .from('profile_assignments')
        .select('profile_id,company_id,project_ids')
        .eq('profile_id', userId)
      const rows = (data ?? []) as Pick<
        ProfileAssignmentRow,
        'profile_id' | 'company_id' | 'project_ids'
      >[]
      const ids = rows.map((row) => row.company_id)
      const scope = projectScopeOf(
        rows.map((row) => ({
          ...row,
          company_name_ar: '',
          company_name_en: null,
          project_names_ar: [],
          project_names_en: [],
        })),
      )
      let linked = false
      if (scope.wholeCompanyIds.length) {
        const { count } = await supabase
          .from('company_projects')
          .select('project_id', { count: 'exact', head: true })
          .in('company_id', scope.wholeCompanyIds)
        linked = (count ?? 0) > 0
      }
      if (!active) return
      setAssignedCompanyIds(ids)
      setWholeCompanyIds(scope.wholeCompanyIds)
      setAssignedProjectIds(scope.projectIds)
      setHasLinkedProjects(linked)
    }
    void load()
    return () => {
      active = false
    }
  }, [userId])

  const loadDrivers = useCallback(
    async (query: string): Promise<AsyncSearchSelectOption[]> => {
      let request = supabase
        .from('drivers')
        .select('id,full_name,name_en,id_number,mobile_number')
        .order('full_name')
        .limit(20)
      const searchFilter = buildSearchFilter(DRIVER_SEARCH_FIELDS, query)
      if (searchFilter) request = request.or(searchFilter)
      return unwrapRows(await request).map(driverOption)
    },
    [],
  )

  const loadCompanies = useCallback(
    async (query: string): Promise<AsyncSearchSelectOption[]> => {
      let request = supabase
        .from('companies')
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      if (assignedCompanyIds.length)
        request = request.in('id', assignedCompanyIds)
      const searchFilter = buildSearchFilter(
        COMPANY_PROJECT_SEARCH_FIELDS,
        query,
      )
      if (searchFilter) request = request.or(searchFilter)
      return unwrapRows(await request).map((company) => ({
        value: company.id,
        label: localizedName(lang, company.name_ar, company.name_en),
      }))
    },
    [assignedCompanyIds, lang],
  )

  const loadProjects = useCallback(
    async (query: string): Promise<AsyncSearchSelectOption[]> => {
      const searchFilter = buildSearchFilter(
        COMPANY_PROJECT_SEARCH_FIELDS,
        query,
      )
      const toOption = (project: {
        id: string
        name_ar: string
        name_en: string | null
      }) => ({
        value: project.id,
        label: localizedName(lang, project.name_ar, project.name_en),
      })
      if (
        assignedCompanyIds.length &&
        (hasLinkedProjects || assignedProjectIds.length)
      ) {
        // The projects of his whole companies (server side, through the
        // company_projects embed) plus the projects he is narrowed to in the
        // others (0176); two bounded reads merged, the first 20 by name.
        const reads: Promise<
          { id: string; name_ar: string; name_en: string | null }[]
        >[] = []
        if (wholeCompanyIds.length && hasLinkedProjects) {
          let linked = supabase
            .from('projects')
            .select('id,name_ar,name_en,company_projects!inner(company_id)')
            .in('company_projects.company_id', wholeCompanyIds)
            .order('name_ar')
            .limit(20)
          if (searchFilter) linked = linked.or(searchFilter)
          reads.push((async () => unwrapRows<ProjectRow>(await linked))())
        }
        if (assignedProjectIds.length) {
          let narrowed = supabase
            .from('projects')
            .select('id,name_ar,name_en')
            .in('id', assignedProjectIds)
            .order('name_ar')
            .limit(20)
          if (searchFilter) narrowed = narrowed.or(searchFilter)
          reads.push((async () => unwrapRows<ProjectRow>(await narrowed))())
        }
        const merged = new Map<string, ProjectRow>()
        for (const list of await Promise.all(reads))
          for (const project of list) merged.set(project.id, project)
        return [...merged.values()]
          .sort((a, b) => a.name_ar.localeCompare(b.name_ar, 'ar'))
          .slice(0, 20)
          .map(toOption)
      }
      let request = supabase
        .from('projects')
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      if (searchFilter) request = request.or(searchFilter)
      return unwrapRows(await request).map(toOption)
    },
    [
      assignedCompanyIds,
      assignedProjectIds,
      hasLinkedProjects,
      lang,
      wholeCompanyIds,
    ],
  )

  const loadEquipmentTypes = useCallback(
    async (query: string): Promise<AsyncSearchSelectOption[]> => {
      let request = supabase
        .from('equipment_types')
        .select('name')
        .order('name')
        .limit(20)
      const searchFilter = buildSearchFilter(NAME_SEARCH_FIELDS, query)
      if (searchFilter) request = request.or(searchFilter)
      return unwrapRows(await request).map((item) => ({
        value: item.name,
        label: item.name,
      }))
    },
    [],
  )

  const loadLessors = useCallback(
    async (query: string): Promise<AsyncSearchSelectOption[]> => {
      let request = supabase
        .from('lessors')
        .select('id,name')
        .order('name')
        .limit(20)
      const searchFilter = buildSearchFilter(NAME_SEARCH_FIELDS, query)
      if (searchFilter) request = request.or(searchFilter)
      return unwrapRows(await request).map((lessor) => ({
        value: lessor.id,
        label: lessor.name,
      }))
    },
    [],
  )

  return {
    loadDrivers,
    loadCompanies,
    loadProjects,
    loadEquipmentTypes,
    loadLessors,
  }
}
