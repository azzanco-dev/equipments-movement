import type {
  CompanyContact,
  CompanyContactFormValues,
  CompanyContactProject,
} from '@/lib/companyContacts'
import type { RpcResult } from '@/lib/purchasingData'
import { supabase } from '@/lib/supabase'

/**
 * company-contacts (0204) — the DATA side of «الاشخاص المسؤولون». Reads go
 * through PostgREST with the signed-in user's token (RLS: `sales.view` or
 * the companies keys); the two writes through the SECURITY DEFINER functions
 * `save_company_contact` / `delete_company_contact` (`sales.manage` or
 * `companies_projects.edit`; the tables carry no write policy).
 */

/** A company's persons with their projects (one bounded read). */
export const COMPANY_CONTACT_SELECT =
  'id,company_id,name,contact_number,email,links:company_contact_projects(project:projects(id,name_ar,name_en))'

/** No company has this many; the bound keeps the read finite. */
export const COMPANY_CONTACTS_LIMIT = 200

interface ContactRow {
  id: string
  company_id: string
  name: string
  contact_number: string | null
  email: string | null
  links: { project: CompanyContactProject | null }[] | null
}

/**
 * The responsible persons of a company, by name. Throws when the read
 * fails, so a failed load is an error state, never «no persons».
 */
export async function fetchCompanyContacts(
  companyId: string,
  signal?: AbortSignal,
): Promise<CompanyContact[]> {
  let query = supabase
    .from('company_contacts')
    .select(COMPANY_CONTACT_SELECT)
    .eq('company_id', companyId)
    .order('name', { ascending: true })
    .order('id', { ascending: true })
    .limit(COMPANY_CONTACTS_LIMIT)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error('company_contacts_load_failed')
  return ((data as unknown as ContactRow[] | null) ?? []).map((row) => ({
    id: row.id,
    company_id: row.company_id,
    name: row.name,
    contact_number: row.contact_number,
    email: row.email,
    // A project the reader may not see comes back null and is left out.
    projects: (row.links ?? [])
      .map((link) => link.project)
      .filter((project): project is CompanyContactProject => Boolean(project)),
  }))
}

function asResult<T>(result: {
  data: unknown
  error: {
    code?: string
    message: string
    details?: string
    hint?: string
  } | null
}): RpcResult<T> {
  if (result.error)
    return {
      data: null,
      error: {
        code: result.error.code,
        message: result.error.message,
        details: result.error.details,
        hint: result.error.hint,
      },
    }
  return { data: result.data as T, error: null }
}

/**
 * `save_company_contact`: `id` null adds a person to the company, else
 * edits that person (the company never changes). Returns the person's id.
 */
export async function saveCompanyContact(input: {
  id: string | null
  companyId: string
  values: CompanyContactFormValues
}): Promise<RpcResult<string>> {
  const { values } = input
  return asResult<string>(
    await supabase.rpc('save_company_contact', {
      p_id: input.id,
      p_company_id: input.companyId,
      p_name: values.name.trim(),
      p_contact_number: values.contact_number.trim() || null,
      p_email: values.email.trim() || null,
      p_project_ids: values.project_ids.length ? values.project_ids : null,
    }),
  )
}

/** `delete_company_contact`: saved quotations keep their copy. */
export async function deleteCompanyContact(
  id: string,
): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('delete_company_contact', { p_id: id }),
  )
}
