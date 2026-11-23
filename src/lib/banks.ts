import type { SupabaseClient } from '@supabase/supabase-js'
import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import type { DatabaseFieldRule } from '@/lib/formValidation'
import { buildSearchFilter, NAME_SEARCH_FIELDS } from '@/lib/search'
import { unwrapRows } from '@/lib/supabaseResult'

/**
 * The banks list (migration 0177, owner 2026-11-05): the supplier's bank is
 * picked from `public.banks`, managed in Settings › «البنوك» by
 * `lessors.edit`. `lessors.bank_name` references `banks.name` (ON UPDATE
 * CASCADE, ON DELETE RESTRICT), so a bank's NAME is its option value.
 */

/** The selector shows the first / best 20, like every relational dropdown. */
export const BANK_OPTION_LIMIT = 20

/** The bank dialog holds a single field. */
export type BankFormValues = { name: string }
export const BANK_FIELD_ORDER = ['name'] as const

/** `banks` (0177): unique on the name and on its lower-case form, and the
 *  1–100 character check. */
export const BANK_DATABASE_RULES: readonly DatabaseFieldRule<BankFormValues>[] =
  [
    { on: 'unique', match: 'banks_name', field: 'name', key: 'duplicateBank' },
    { on: 'check', match: 'banks_name', field: 'name', key: 'bankRequired' },
  ]

/** A delete refused by a foreign key to `banks.name` (23503): a supplier
 *  (`lessors`, 0177), a financier or a contract with its own account
 *  (`installment_financiers` / `installment_contracts`, 0208). */
export function bankInUse(error: { code?: string } | null | undefined) {
  return error?.code === '23503'
}

/**
 * Settings › «البنوك» as wide tiles (owner 2026-11-23, approved in Figma):
 * the tile shows no counts, but a bank in use has «حذف» locked with its
 * reason. Its use is read with the bank, each count only where the reader
 * may read it: the suppliers always (the page needs `lessors.edit`), the
 * financiers and the contracts with their own account only with
 * `installments.view` (RLS would answer 0 anyway; the read is skipped).
 * The foreign keys refuse the delete of a used bank in every case.
 */
export function banksSelect(withInstallments: boolean) {
  return withInstallments
    ? 'id,name,lessors(count),installment_financiers(count),installment_contracts(count)'
    : 'id,name,lessors(count)'
}

type CountEmbed = Array<{ count: number }> | null | undefined
export type BankUsageRow = {
  lessors?: CountEmbed
  installment_financiers?: CountEmbed
  installment_contracts?: CountEmbed
}

/** Every use of a bank the reader could read. */
export function bankUsageCount(row: BankUsageRow) {
  const count = (embed: CountEmbed) => embed?.[0]?.count ?? 0
  return (
    count(row.lessors) +
    count(row.installment_financiers) +
    count(row.installment_contracts)
  )
}

/** The bank selector of the supplier form: server-side search, 20 at most;
 *  throws on a failed read so the control shows its load error. */
export function bankOptionLoader(client: SupabaseClient) {
  return async (query: string): Promise<AsyncSearchSelectOption[]> => {
    let request = client
      .from('banks')
      .select('name')
      .order('name')
      .limit(BANK_OPTION_LIMIT)
    const searchFilter = buildSearchFilter(NAME_SEARCH_FIELDS, query)
    if (searchFilter) request = request.or(searchFilter)
    return unwrapRows<{ name: string }>(await request).map((row) => ({
      value: row.name,
      label: row.name,
    }))
  }
}

/** The banks list keyed by `bankKey`, for the supplier import (throws on a
 *  failed read). The list is small (a few dozen banks), so one bounded read
 *  keeps the case-insensitive match simple and lets the import write the
 *  list's own spelling. */
export async function fetchBankNames(
  client: SupabaseClient,
): Promise<Map<string, string>> {
  const { data, error } = await client
    .from('banks')
    .select('name')
    .limit(BANK_IMPORT_READ_LIMIT)
  if (error) throw error
  const known = new Map<string, string>()
  for (const row of (data ?? []) as { name: string }[])
    known.set(bankKey(row.name), row.name)
  return known
}

/** The bound of the import's read of the list. */
export const BANK_IMPORT_READ_LIMIT = 1000

/**
 * The import rows' banks: a name of the list is replaced by the list's
 * spelling; any other name marks its row (`bankNotInList`), since the
 * foreign key of 0177 would refuse it.
 */
export function matchImportBanks(
  rows: readonly { bank_name?: string | null; _errors: string[] }[],
  known: ReadonlyMap<string, string>,
  notInList: string,
): void {
  for (const row of rows) {
    if (!row.bank_name) continue
    const name = known.get(bankKey(row.bank_name))
    if (name) row.bank_name = name
    else row._errors.push(notInList)
  }
}

/** The comparison form of a bank name. */
export function bankKey(name: string) {
  return name.trim().toLocaleLowerCase()
}
