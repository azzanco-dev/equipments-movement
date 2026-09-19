import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/i18n/I18nContext'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import { driverOption } from '@/lib/driverOptions'
import { localizedName } from '@/lib/localizedName'
import { sanitizeSearchTerm } from '@/lib/search'

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
 */
export function useMovementFormOptions(): MovementFormOptionLoaders {
  const { lang } = useI18n()

  const loadDrivers = useCallback(
    async (query: string): Promise<AsyncSearchSelectOption[]> => {
      let request = supabase
        .from('drivers')
        .select('id,full_name,name_en,id_number,mobile_number')
        .order('full_name')
        .limit(20)
      const term = sanitizeSearchTerm(query)
      if (term)
        request = request.or(
          `full_name.ilike.%${term}%,name_en.ilike.%${term}%,id_number.ilike.%${term}%,mobile_number.ilike.%${term}%`,
        )
      const { data, error } = await request
      if (error) return []
      return (data ?? []).map(driverOption)
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
      const term = sanitizeSearchTerm(query)
      if (term)
        request = request.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data } = await request
      return (data ?? []).map((company) => ({
        value: company.id,
        label: localizedName(lang, company.name_ar, company.name_en),
      }))
    },
    [lang],
  )

  const loadProjects = useCallback(
    async (query: string): Promise<AsyncSearchSelectOption[]> => {
      let request = supabase
        .from('projects')
        .select('id,name_ar,name_en')
        .order('name_ar')
        .limit(20)
      const term = sanitizeSearchTerm(query)
      if (term)
        request = request.or(`name_ar.ilike.%${term}%,name_en.ilike.%${term}%`)
      const { data } = await request
      return (data ?? []).map((project) => ({
        value: project.id,
        label: localizedName(lang, project.name_ar, project.name_en),
      }))
    },
    [lang],
  )

  const loadEquipmentTypes = useCallback(
    async (query: string): Promise<AsyncSearchSelectOption[]> => {
      let request = supabase
        .from('equipment_types')
        .select('name')
        .order('name')
        .limit(20)
      const term = sanitizeSearchTerm(query)
      if (term) request = request.ilike('name', `%${term}%`)
      const { data } = await request
      return (data ?? []).map((item) => ({
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
      const term = sanitizeSearchTerm(query)
      if (term) request = request.ilike('name', `%${term}%`)
      const { data } = await request
      return (data ?? []).map((lessor) => ({
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
