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
  const [assignedCompanyIds, setAssignedCompanyIds] = useState<string[]>([])
  const [hasLinkedProjects, setHasLinkedProjects] = useState(false)
  useEffect(() => {
    if (!userId) return
    let active = true
    const load = async () => {
      const { data } = await supabase
        .from('profile_companies')
        .select('company_id')
        .eq('profile_id', userId)
      const ids = (data ?? []).map((row) => row.company_id as string)
      let linked = false
      if (ids.length) {
        const { count } = await supabase
          .from('company_projects')
          .select('project_id', { count: 'exact', head: true })
          .in('company_id', ids)
        linked = (count ?? 0) > 0
      }
      if (!active) return
      setAssignedCompanyIds(ids)
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
      if (assignedCompanyIds.length && hasLinkedProjects) {
        // The projects linked to the user's companies (server side, through
        // the company_projects embed; one row per project).
        let linked = supabase
          .from('projects')
          .select('id,name_ar,name_en,company_projects!inner(company_id)')
          .in('company_projects.company_id', assignedCompanyIds)
          .order('name_ar')
          .limit(20)
        if (searchFilter) linked = linked.or(searchFilter)
        return unwrapRows(await linked).map(toOption)
      }
      let request = supabase
        .from('projects')
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      if (searchFilter) request = request.or(searchFilter)
      return unwrapRows(await request).map(toOption)
    },
    [assignedCompanyIds, hasLinkedProjects, lang],
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
