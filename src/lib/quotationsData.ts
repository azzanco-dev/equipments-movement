import type { PostgresLikeError } from '@/lib/formValidation'
import type { RpcResult } from '@/lib/purchasingData'
import {
  quotationCostsPayload,
  quotationLinesPayload,
  quotationTermTemplatePayload,
  type QuotationCost,
  type QuotationFormValues,
  type QuotationLine,
  type QuotationRow,
  type QuotationTerm,
  type QuotationTermTemplate,
  type QuotationTermTemplateFormValues,
} from '@/lib/quotations'
import { supabase } from '@/lib/supabase'

/**
 * quotations (0199) — the DATA side of «عروض الاسعار»: the rows the screens
 * select and the functions they call. Every read goes through PostgREST
 * with the signed-in user's token (RLS: `sales.view`); every write of a
 * quotation through the three SECURITY DEFINER functions migration 0200
 * left — `save_quotation`, `delete_quotation`, `copy_quotation`
 * (`sales.manage`; no insert / update policy on the quotation tables). A
 * quotation is a plain document without states. The terms template of
 * Settings is written directly under its RLS (`sales.quotations.approve`)
 * and read back with `.select('id')`, as the banks are. The pure labels and
 * the token map live in `src/lib/quotations.ts`.
 */

// --- Selects -------------------------------------------------------------------

/** The columns of `quotation_list` the list and the page read (the view
 *  after 0200). */
export const QUOTATION_LIST_SELECT =
  'id,company_id,project_id,quote_number,issue_date,valid_until,notes,created_by,created_at,updated_at,company_name_ar,company_name_en,project_name_ar,project_name_en,created_by_name,line_count,type_names'

export const QUOTATION_LINE_SELECT =
  'id,quotation_id,equipment_type,daily_price,monthly_price,mob_demob_price,note,position'

export const QUOTATION_COST_SELECT = 'id,quotation_id,name,borne_by,position'

export const QUOTATION_TERM_SELECT =
  'id,quotation_id,template_id,body_ar,body_en,position'

export const QUOTATION_TERM_TEMPLATE_SELECT =
  'id,body_ar,body_en,position,is_default,created_at,updated_at'

/** The client's official numbers the PDF prints under its name (0175). */
export const QUOTATION_COMPANY_SELECT = 'id,tax_number,commercial_register'

export interface QuotationCompanyNumbers {
  id: string
  tax_number: string | null
  commercial_register: string | null
}

/** One quotation with everything its page and its PDF show. */
export interface QuotationDetailData {
  quotation: QuotationRow
  lines: QuotationLine[]
  costs: QuotationCost[]
  terms: QuotationTerm[]
  /** Null when the company row is not readable (the PDF then omits the
   *  two numbers). */
  company: QuotationCompanyNumbers | null
}

// --- Reads ---------------------------------------------------------------------

/**
 * A quotation (the `quotation_list` row) with its lines, costs and terms in
 * `position` order; null when no row is readable. Throws when a read fails,
 * so the page shows its error state, never an empty quotation.
 */
export async function fetchQuotation(
  id: string,
  signal?: AbortSignal,
): Promise<QuotationDetailData | null> {
  const withSignal = <Q extends { abortSignal: (signal: AbortSignal) => Q }>(
    query: Q,
  ): Q => (signal ? query.abortSignal(signal) : query)
  const [rowResult, linesResult, costsResult, termsResult] = await Promise.all([
    withSignal(
      supabase
        .from('quotation_list')
        .select(QUOTATION_LIST_SELECT)
        .eq('id', id),
    ).maybeSingle(),
    withSignal(
      supabase
        .from('quotation_lines')
        .select(QUOTATION_LINE_SELECT)
        .eq('quotation_id', id)
        .order('position', { ascending: true })
        .order('id', { ascending: true }),
    ),
    withSignal(
      supabase
        .from('quotation_costs')
        .select(QUOTATION_COST_SELECT)
        .eq('quotation_id', id)
        .order('position', { ascending: true })
        .order('id', { ascending: true }),
    ),
    withSignal(
      supabase
        .from('quotation_terms')
        .select(QUOTATION_TERM_SELECT)
        .eq('quotation_id', id)
        .order('position', { ascending: true })
        .order('id', { ascending: true }),
    ),
  ])
  const failed =
    rowResult.error ??
    linesResult.error ??
    costsResult.error ??
    termsResult.error
  if (failed) throw new Error('quotation_load_failed')
  const quotation = rowResult.data as unknown as QuotationRow | null
  if (!quotation) return null
  // The company's numbers are a nicety of the PDF: a failed read leaves
  // them out instead of failing the page.
  const companyResult = await withSignal(
    supabase
      .from('companies')
      .select(QUOTATION_COMPANY_SELECT)
      .eq('id', quotation.company_id),
  ).maybeSingle()
  return {
    quotation,
    lines: (linesResult.data as unknown as QuotationLine[] | null) ?? [],
    costs: (costsResult.data as unknown as QuotationCost[] | null) ?? [],
    terms: (termsResult.data as unknown as QuotationTerm[] | null) ?? [],
    company: companyResult.error
      ? null
      : ((companyResult.data as unknown as QuotationCompanyNumbers | null) ??
        null),
  }
}

/** The Settings template, in its position order. Throws on failure, so a
 *  failed load is never read as «no terms». */
export async function fetchQuotationTermTemplates(
  signal?: AbortSignal,
): Promise<QuotationTermTemplate[]> {
  let query = supabase
    .from('quotation_term_templates')
    .select(QUOTATION_TERM_TEMPLATE_SELECT)
    .order('position', { ascending: true })
    .order('id', { ascending: true })
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error('quotation_terms_load_failed')
  return (data as unknown as QuotationTermTemplate[] | null) ?? []
}

// --- Writes of a quotation (the three functions) -------------------------------

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
 * `save_quotation`: `id` null creates a quotation (its official number is
 * issued then), else replaces that quotation's fields, lines, costs and
 * terms wholesale — any quotation, there is no lock. Returns the quotation
 * id.
 */
export async function saveQuotation(input: {
  id: string | null
  values: QuotationFormValues
}): Promise<RpcResult<string>> {
  const { values } = input
  return asResult<string>(
    await supabase.rpc('save_quotation', {
      p_id: input.id,
      p_company_id: values.company_id,
      p_project_id: values.project_id || null,
      p_issue_date: values.issue_date || null,
      p_valid_until: values.valid_until || null,
      p_notes: values.notes.trim() || null,
      p_lines: quotationLinesPayload(values.lines),
      p_costs: quotationCostsPayload(values.costs),
      p_term_template_ids: values.term_template_ids,
      // An edit keeps the stored copies it names; a new quotation has none.
      p_keep_term_ids:
        input.id && values.keep_term_ids.length ? values.keep_term_ids : null,
    }),
  )
}

/** `delete_quotation`: any quotation, for good; its number is never used
 *  again. */
export async function deleteQuotation(id: string): Promise<RpcResult<null>> {
  return asResult<null>(await supabase.rpc('delete_quotation', { p_id: id }))
}

/** `copy_quotation`: a new quotation (a new official number, dated today,
 *  the same validity in days); returns its id. */
export async function copyQuotation(id: string): Promise<RpcResult<string>> {
  return asResult<string>(await supabase.rpc('copy_quotation', { p_id: id }))
}

// --- Writes of the terms template (direct, under RLS) -----------------------

/**
 * A template write: `refused` when RLS refused it (an insert's 42501, or an
 * update / delete that read back no row), else the database error to map.
 */
export type TemplateWriteResult =
  | { ok: true; id: string }
  | { ok: false; refused: boolean; error: PostgresLikeError | null }

function templateResult(result: {
  data: { id: string }[] | null
  error: {
    code?: string
    message: string
    details?: string
    hint?: string
  } | null
}): TemplateWriteResult {
  if (result.error)
    return {
      ok: false,
      refused: result.error.code === '42501',
      error: {
        code: result.error.code,
        message: result.error.message,
        details: result.error.details,
        hint: result.error.hint,
      },
    }
  const id = result.data?.[0]?.id
  return id ? { ok: true, id } : { ok: false, refused: true, error: null }
}

export async function insertQuotationTermTemplate(
  values: QuotationTermTemplateFormValues,
): Promise<TemplateWriteResult> {
  return templateResult(
    await supabase
      .from('quotation_term_templates')
      .insert(quotationTermTemplatePayload(values))
      .select('id'),
  )
}

export async function updateQuotationTermTemplate(
  id: string,
  values: QuotationTermTemplateFormValues,
): Promise<TemplateWriteResult> {
  return templateResult(
    await supabase
      .from('quotation_term_templates')
      .update(quotationTermTemplatePayload(values))
      .eq('id', id)
      .select('id'),
  )
}

export async function deleteQuotationTermTemplate(
  id: string,
): Promise<TemplateWriteResult> {
  return templateResult(
    await supabase
      .from('quotation_term_templates')
      .delete()
      .eq('id', id)
      .select('id'),
  )
}
