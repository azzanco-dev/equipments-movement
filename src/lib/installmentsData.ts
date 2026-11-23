import type { AsyncSearchSelectOption } from '@/components/AsyncSearchSelect'
import type { PostgresLikeError } from '@/lib/formValidation'
import {
  amountOf,
  cashflowWindowEnd,
  currentMonthRange,
  sumAmounts,
  EMPTY_INSTALLMENT_OVERVIEW,
  type InstallmentAllocationRow,
  type InstallmentContractItem,
  type InstallmentContractRow,
  type InstallmentDueRow,
  type InstallmentDuesView,
  type InstallmentFinancierRow,
  type InstallmentOverviewRow,
  type InstallmentPaymentRow,
  type InstallmentRowKind,
  type InstallmentScheduleItem,
  type InstallmentUnit,
} from '@/lib/installmentsView'
import type {
  InstallmentContractStatus,
  InstallmentPaymentMethod,
} from '@/lib/installments'
import type { RpcResult } from '@/lib/purchasingData'
import {
  buildSearchFilter,
  EQUIPMENT_CODE_TYPE_SEARCH_FIELDS,
} from '@/lib/search'
import { bankOptionLoader } from '@/lib/banks'
import {
  addDays,
  ENDING_SOON_DAYS,
  type ContractChip,
  type ContractFigureRow,
  type ContractSort,
  type DuesFeedView,
} from '@/lib/installmentsBoard'
import { normalizeIban } from '@/lib/partyFields'
import { supabase } from '@/lib/supabase'
import { SupabaseLoadError, unwrapRows } from '@/lib/supabaseResult'
import type { ListFilter } from '@/components/data-list/types'
import { applyListFilters } from '@/lib/applyListFilters'
import {
  INSTALLMENT_FILE_SELECT,
  type InstallmentFile,
} from '@/lib/installmentFiles'
import type {
  InstallmentFirstPaymentPayload,
  InstallmentItemPayload,
  InstallmentVatPayload,
} from '@/lib/installmentPlan'
import {
  installmentContractsListConfig,
  installmentDuesListConfig,
} from '@/lib/listConfigs'

/**
 * installments-screens — the DATA side of «الاقساط» (migration 0203): the
 * rows the screens select and the functions they call. Every read goes
 * through PostgREST with the signed-in user's token (RLS:
 * `installments.view`) and THROWS on failure, so a screen shows its error
 * state, never an empty list. Contracts, their units, the schedule, the
 * payments and the allocations are written ONLY by the four SECURITY
 * DEFINER functions — `save_installment_contract`,
 * `cancel_installment_contract`, `record_installment_payment`,
 * `void_installment_payment` (`installments.manage`; those tables have no
 * write policy). The financiers alone are written directly under their RLS
 * and read back with `.select('id')`, as the banks are. The pure rules and
 * the token map live in `src/lib/installments.ts` and
 * `src/lib/installmentsView.ts`.
 */

// --- Selects (only the columns the screens show) ----------------------------------------

export const INSTALLMENT_OVERVIEW_SELECT =
  'overdue_count,overdue_amount,due_7_count,due_7_amount,due_30_count,due_30_amount,open_count,remaining_total,open_contract_count,next_due_date'

export const INSTALLMENT_DUE_SELECT =
  'id,contract_id,contract_number,description,financier_id,financier_name,seq,installment_count,due_date,amount,paid_amount,remaining_amount,is_balloon,is_partial,state,days_until_due,kind,title,note'

/** The dues lists also show the payment date of a paid row (0207). */
export const INSTALLMENT_DUES_LIST_SELECT = `${INSTALLMENT_DUE_SELECT},last_paid_on`

export const INSTALLMENT_CONTRACT_SELECT =
  'id,contract_number,description,financier_id,financier_name,total_amount,down_payment,balloon_amount,financed_amount,installment_count,frequency_months,first_due_date,notes,status,closed_at,cancel_reason,created_by_name,created_at,updated_at,paid_total,remaining_total,paid_count,overdue_count,overdue_amount,next_due_date,next_due_amount,last_due_date,equipment_count,financier_bank_name,financier_iban,contract_bank_name,contract_iban,vat_mode,vat_due,vat_amount,vat_due_date,installments_amount,payable_total,paid_overall,first_payments_count,first_payments_paid_count,first_payments_total,installments_locked,next_due_id,next_due_kind,next_due_title,next_due_seq,first_due_set_at,first_due_set_by_name,vat_settled'

/** 0210: the items of a contract. */
export const INSTALLMENT_ITEM_SELECT = 'id,position,name,quantity'
/** A contract has at most 100 items (installment_contract_items). */
const CONTRACT_ITEMS_CAP = 100

export const INSTALLMENT_SCHEDULE_SELECT =
  'id,contract_id,seq,due_date,amount,is_balloon,paid_amount,kind,title,note,rate'

export const INSTALLMENT_PAYMENT_SELECT =
  'id,contract_id,paid_on,amount,method,reference,note,status,voided_at,voided_by_name,void_reason,created_by_name,created_at,receipt_id,receipt_path,receipt_file_name,receipt_mime_type,receipt_size_bytes'

export const INSTALLMENT_FINANCIER_SELECT = 'id,name,bank_name,iban'

/** A contract's units with the unit's code and type (null when RLS hides
 *  the unit from this reader). */
export const INSTALLMENT_UNIT_SELECT =
  'contract_id,equipment_id,equipment(code,type)'

/** Which installments a payment covered: the allocation with the `seq` of
 *  its schedule row, limited to one contract through the inner embed. */
export const INSTALLMENT_ALLOCATION_SELECT =
  'payment_id,amount,installment_schedule!inner(seq,kind,title,contract_id)'

// --- The caps of the bounded reads ------------------------------------------------------

/** The total of the dues view adds up at most this many rows. */
export const DUES_TOTAL_CAP = 5000
/** The financier figures read at most this many contracts. */
export const FINANCIER_CONTRACTS_CAP = 5000
/** The financiers are a small list of names. */
export const FINANCIERS_CAP = 1000
/** The units of one page of contracts. */
export const CONTRACT_UNITS_CAP = 1000
/** A contract has at most 461 schedule rows: 360 installments (0203), 100
 *  first payments and the VAT row (0209). */
export const SCHEDULE_ROWS_CAP = 500
export const CONTRACT_FILES_CAP = 200
export const CONTRACT_PAYMENTS_CAP = 1000
export const CONTRACT_ALLOCATIONS_CAP = 5000
/** Relational selectors show the first / best 20. */
export const INSTALLMENT_OPTION_LIMIT = 20

type Abortable<Q> = { abortSignal: (signal: AbortSignal) => Q }

const withSignal = <Q extends Abortable<Q>>(
  query: Q,
  signal: AbortSignal | undefined,
): Q => (signal ? query.abortSignal(signal) : query)

/** The rows of a result as `T[]`; throws when the read failed. */
function rowsOf<T>(result: { data: unknown; error: unknown }): T[] {
  return unwrapRows<T>(result as { data: T[] | null; error: unknown })
}

/** The exact count of a head request; throws when it failed. */
function countOf(result: { count: number | null; error: unknown }): number {
  if (result.error) throw new SupabaseLoadError()
  return result.count ?? 0
}

// --- Page-level reads ------------------------------------------------------------------

/** `installment_overview`: the four figures (ONE row, whatever the data). */
export async function fetchInstallmentOverview(
  signal?: AbortSignal,
): Promise<InstallmentOverviewRow> {
  const result = await withSignal(
    supabase.from('installment_overview').select(INSTALLMENT_OVERVIEW_SELECT),
    signal,
  ).maybeSingle()
  if (result.error) throw new SupabaseLoadError()
  const row = result.data as Partial<InstallmentOverviewRow> | null
  if (!row) return EMPTY_INSTALLMENT_OVERVIEW
  return {
    overdue_count: Number(row.overdue_count ?? 0),
    overdue_amount: amountOf(row.overdue_amount),
    due_7_count: Number(row.due_7_count ?? 0),
    due_7_amount: amountOf(row.due_7_amount),
    due_30_count: Number(row.due_30_count ?? 0),
    due_30_amount: amountOf(row.due_30_amount),
    open_count: Number(row.open_count ?? 0),
    remaining_total: amountOf(row.remaining_total),
    open_contract_count: Number(row.open_contract_count ?? 0),
    next_due_date: row.next_due_date ?? null,
  }
}

/** Every contract, whatever its status (the «العقود» tab's count). */
export async function fetchInstallmentContractsCount(
  signal?: AbortSignal,
): Promise<number> {
  return countOf(
    await withSignal(
      supabase
        .from('installment_contracts')
        .select('id', { count: 'exact', head: true }),
      signal,
    ),
  )
}

/** The financiers by name: a small list, one bounded read. */
export async function fetchInstallmentFinanciers(
  signal?: AbortSignal,
): Promise<InstallmentFinancierRow[]> {
  return rowsOf<InstallmentFinancierRow>(
    await withSignal(
      supabase
        .from('installment_financiers')
        .select(INSTALLMENT_FINANCIER_SELECT)
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .limit(FINANCIERS_CAP),
      signal,
    ),
  )
}

// --- «اللوحة» --------------------------------------------------------------------------

/** The unpaid rows of the ACTIVE contracts: what every dues read starts
 *  from. */
function openDues(
  columns: string,
  options?: { count: 'exact'; head?: boolean },
) {
  return supabase
    .from('installment_dues')
    .select(columns, options)
    .eq('contract_status', 'active')
    .eq('is_paid', false)
}

/** The active contracts that carry an overdue row (the overdue figure's
 *  «في N عقود»). */
export async function fetchOverdueContractsCount(
  signal?: AbortSignal,
): Promise<number> {
  return countOf(
    await withSignal(
      supabase
        .from('installment_contract_summary')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .gt('overdue_count', 0),
      signal,
    ),
  )
}

/** The nearest row that is not late yet, or null. */
export async function fetchNearestDue(
  signal?: AbortSignal,
): Promise<InstallmentDueRow | null> {
  const rows = rowsOf<InstallmentDueRow>(
    await withSignal(
      openDues(INSTALLMENT_DUE_SELECT)
        .gte('days_until_due', 0)
        .order('due_date', { ascending: true })
        .order('contract_number', { ascending: true })
        .order('kind', { ascending: true })
        .order('seq', { ascending: true })
        .limit(1),
      signal,
    ),
  )
  return rows[0] ?? null
}

/** The rows due today or within 30 days, the nearest first. */
export async function fetchUpcomingDues(
  limit: number,
  signal?: AbortSignal,
): Promise<InstallmentDueRow[]> {
  return rowsOf<InstallmentDueRow>(
    await withSignal(
      openDues(INSTALLMENT_DUE_SELECT)
        .gte('days_until_due', 0)
        .lte('days_until_due', 30)
        .order('due_date', { ascending: true })
        .order('contract_number', { ascending: true })
        .order('kind', { ascending: true })
        .order('seq', { ascending: true })
        .limit(limit),
      signal,
    ),
  )
}

// --- «العقود» ---------------------------------------------------------------------------

/** The columns the contracts search looks in. */
export const INSTALLMENT_CONTRACT_SEARCH_FIELDS = [
  'contract_number',
  'description',
  'financier_name',
] as const

/** The shared list state a page of «العقود» / «الاستحقاقات» is read with
 *  (`useDataListState`). */
export interface InstallmentListQuery {
  search: string
  filters: readonly ListFilter[]
  sort: string
  direction: 'asc' | 'desc'
  page: number
  pageSize: number
}

/** Filter keys the contracts tab applies itself (not view columns). */
export const INSTALLMENT_CONTRACT_COLUMN_FILTERS: ReadonlySet<string> = new Set(
  ['has_overdue'],
)

const allowedKeys = (
  fields: readonly { key: string }[],
  skip: ReadonlySet<string> = new Set(),
) => new Set(fields.map((field) => field.key).filter((key) => !skip.has(key)))

const CONTRACT_FILTER_KEYS = allowedKeys(
  installmentContractsListConfig.filterFields,
  INSTALLMENT_CONTRACT_COLUMN_FILTERS,
)
const CONTRACT_SORT_KEYS = new Set(
  installmentContractsListConfig.sortableFields.map((field) => field.key),
)

/** One page of `installment_contract_summary`: searched, filtered, sorted
 *  and paged on the server. */
export async function fetchInstallmentContractsPage(
  query: InstallmentListQuery,
  signal?: AbortSignal,
): Promise<{ rows: InstallmentContractRow[]; total: number }> {
  const ascending = query.direction === 'asc'
  const sort = CONTRACT_SORT_KEYS.has(query.sort)
    ? query.sort
    : installmentContractsListConfig.defaultSort
  let request = supabase
    .from('installment_contract_summary')
    .select(INSTALLMENT_CONTRACT_SELECT, { count: 'exact' })
  // «القسط القادم»: the active contracts first, the closed ones (no row
  // left to pay, or cancelled) after them.
  if (sort === 'next_due_date')
    request = request.order('status', { ascending: true })
  request = request
    .order(sort, { ascending, nullsFirst: false })
    .order('id', { ascending })
    .range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1)
  const searchFilter = buildSearchFilter(
    installmentContractsListConfig.searchFields,
    query.search,
  )
  if (searchFilter) request = request.or(searchFilter)
  request = applyListFilters(request, [...query.filters], CONTRACT_FILTER_KEYS)
  // The view counts the late rows of a closed contract too; «المتاخرة فقط»
  // is about the contracts still running.
  const overdue = query.filters.find((filter) => filter.field === 'has_overdue')
  if (overdue?.value === 'true')
    request = request.eq('status', 'active').gt('overdue_count', 0)
  else if (overdue?.value === 'false')
    request = request.or('status.neq.active,overdue_count.eq.0')
  const result = await withSignal(request, signal)
  if (result.error) throw new SupabaseLoadError()
  return {
    rows: (result.data as unknown as InstallmentContractRow[] | null) ?? [],
    total: result.count ?? 0,
  }
}

type UnitLinkRow = {
  contract_id: string
  equipment_id: string
  equipment: { code: string; type: string | null } | null
}

/** The units of some contracts (one page of a list, or one contract) with
 *  each unit's code and type, ONE bounded read. */
export async function fetchInstallmentContractUnits(
  contractIds: readonly string[],
  signal?: AbortSignal,
): Promise<InstallmentUnit[]> {
  if (contractIds.length === 0) return []
  return rowsOf<UnitLinkRow>(
    await withSignal(
      supabase
        .from('installment_contract_equipment')
        .select(INSTALLMENT_UNIT_SELECT)
        .in('contract_id', [...contractIds])
        .order('contract_id', { ascending: true })
        .order('equipment_id', { ascending: true })
        .limit(CONTRACT_UNITS_CAP),
      signal,
    ),
  ).map((row) => ({
    contract_id: row.contract_id,
    equipment_id: row.equipment_id,
    code: row.equipment?.code ?? null,
    type: row.equipment?.type ?? null,
  }))
}

// --- «الاستحقاقات» ----------------------------------------------------------------------

export interface InstallmentDuesQuery {
  view: InstallmentDuesView
  /** The Saudi today (yyyy-mm-dd): «هذا الشهر» is its month. */
  today: string
  search?: string
  filters?: readonly ListFilter[]
}

const DUES_FILTER_KEYS = allowedKeys(installmentDuesListConfig.filterFields)
const DUES_SORT_KEYS = new Set(
  installmentDuesListConfig.sortableFields.map((field) => field.key),
)

/** The rows a dues view starts from: the unpaid rows of the active
 *  contracts, or for «المسددة» the fully paid rows of the contracts that are
 *  not cancelled (active or paid off). */
function duesBase(
  view: InstallmentDuesView,
  columns: string,
  options?: { count: 'exact'; head?: boolean },
) {
  if (view !== 'paid') return openDues(columns, options)
  return supabase
    .from('installment_dues')
    .select(columns, options)
    .in('contract_status', ['active', 'paid_off'])
    .eq('is_paid', true)
}

/** The sub-tab, the search and the filters of the dues, on any read that
 *  starts from `duesBase`. */
function inDuesView<Q extends ReturnType<typeof openDues>>(
  request: Q,
  query: InstallmentDuesQuery,
): Q {
  let next = request
  if (query.view === 'overdue') next = next.lt('days_until_due', 0)
  else if (query.view === 'next30')
    next = next.gte('days_until_due', 0).lte('days_until_due', 30)
  else if (query.view === 'month') {
    const { from, to } = currentMonthRange(query.today)
    next = next.gte('due_date', from).lt('due_date', to)
  }
  const searchFilter = buildSearchFilter(
    installmentDuesListConfig.searchFields,
    query.search ?? '',
  )
  if (searchFilter) next = next.or(searchFilter)
  return applyListFilters(
    next,
    [...(query.filters ?? [])],
    DUES_FILTER_KEYS,
  ) as Q
}

/** One page of a dues view with the view's exact count. */
export async function fetchInstallmentDuesPage(
  query: InstallmentDuesQuery & {
    sort: string
    direction: 'asc' | 'desc'
    page: number
    pageSize: number
  },
  signal?: AbortSignal,
): Promise<{ rows: InstallmentDueRow[]; total: number }> {
  let ascending = query.direction === 'asc'
  let sort = DUES_SORT_KEYS.has(query.sort)
    ? query.sort
    : installmentDuesListConfig.defaultSort
  // «المسددة» opens on the latest paid first while the list keeps its
  // default sort.
  if (
    query.view === 'paid' &&
    sort === installmentDuesListConfig.defaultSort &&
    query.direction === installmentDuesListConfig.defaultDirection
  ) {
    sort = 'last_paid_on'
    ascending = false
  }
  const result = await withSignal(
    inDuesView(
      duesBase(query.view, INSTALLMENT_DUES_LIST_SELECT, { count: 'exact' }),
      query,
    )
      .order(sort, { ascending, nullsFirst: false })
      .order('due_date', { ascending: query.view !== 'paid' })
      .order('contract_number', { ascending: true })
      .order('kind', { ascending: true })
      .order('seq', { ascending: true })
      .range(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize - 1,
      ),
    signal,
  )
  if (result.error) throw new SupabaseLoadError()
  return {
    rows: (result.data as unknown as InstallmentDueRow[] | null) ?? [],
    total: result.count ?? 0,
  }
}

/**
 * The total of the WHOLE filtered view (never the loaded page alone): what
 * is still to pay (`remaining_amount`), or for «المسددة» what was paid
 * (`amount`); a bounded read, `partial` when the cap was reached.
 */
export async function fetchInstallmentDuesTotal(
  query: InstallmentDuesQuery,
  signal?: AbortSignal,
): Promise<{ total: number; partial: boolean }> {
  const paid = query.view === 'paid'
  const rows = rowsOf<{ amount: number; remaining_amount: number }>(
    await withSignal(
      inDuesView(duesBase(query.view, 'amount,remaining_amount'), query)
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .limit(DUES_TOTAL_CAP),
      signal,
    ),
  )
  return {
    total: sumAmounts(
      rows.map((row) => (paid ? row.amount : row.remaining_amount)),
    ),
    partial: rows.length >= DUES_TOTAL_CAP,
  }
}

/** The count of «هذا الشهر» or «المسددة» (the other three sub-tabs read
 *  theirs from the overview). */
export async function fetchInstallmentDuesViewCount(
  view: 'month' | 'paid',
  today: string,
  signal?: AbortSignal,
): Promise<number> {
  return countOf(
    await withSignal(
      inDuesView(duesBase(view, 'id', { count: 'exact', head: true }), {
        view,
        today,
      }),
      signal,
    ),
  )
}

// --- «الجهات» ---------------------------------------------------------------------------

/** The contracts behind the financier figures (grouped by the pure
 *  `financierFigures`); `partial` when the cap was reached. */
export async function fetchFinancierContractRows(
  signal?: AbortSignal,
): Promise<{
  rows: {
    financier_id: string
    status: InstallmentContractStatus
    remaining_total: number
    next_due_date: string | null
  }[]
  partial: boolean
}> {
  const rows = rowsOf<{
    financier_id: string
    status: InstallmentContractStatus
    remaining_total: number
    next_due_date: string | null
  }>(
    await withSignal(
      supabase
        .from('installment_contract_summary')
        .select('financier_id,status,remaining_total,next_due_date')
        .order('id', { ascending: true })
        .limit(FINANCIER_CONTRACTS_CAP),
      signal,
    ),
  )
  return { rows, partial: rows.length >= FINANCIER_CONTRACTS_CAP }
}

// --- The contract page --------------------------------------------------------------------

/** One contract with everything its page shows. */
export interface InstallmentContractDetailData {
  contract: InstallmentContractRow
  schedule: InstallmentScheduleItem[]
  payments: InstallmentPaymentRow[]
  allocations: InstallmentAllocationRow[]
  units: InstallmentUnit[]
  /** 0209: the contract's files, the oldest first. */
  files: InstallmentFile[]
  /** 0210: what the contract covers, in its order. */
  items: InstallmentContractItem[]
}

type AllocationEmbedRow = {
  payment_id: string
  amount: number
  installment_schedule: {
    seq: number
    kind: InstallmentRowKind
    title: string | null
  } | null
}

/** A contract's schedule, in its order. */
async function fetchSchedule(
  contractId: string,
  signal?: AbortSignal,
): Promise<InstallmentScheduleItem[]> {
  return rowsOf<InstallmentScheduleItem>(
    await withSignal(
      supabase
        .from('installment_schedule')
        .select(INSTALLMENT_SCHEDULE_SELECT)
        .eq('contract_id', contractId)
        .order('kind', { ascending: true })
        .order('seq', { ascending: true })
        .limit(SCHEDULE_ROWS_CAP),
      signal,
    ),
  )
}

async function fetchContractRow(
  contractId: string,
  signal?: AbortSignal,
): Promise<InstallmentContractRow | null> {
  const result = await withSignal(
    supabase
      .from('installment_contract_summary')
      .select(INSTALLMENT_CONTRACT_SELECT)
      .eq('id', contractId),
    signal,
  ).maybeSingle()
  if (result.error) throw new SupabaseLoadError()
  return (result.data as unknown as InstallmentContractRow | null) ?? null
}

/** A contract's files (0209), the oldest first. */
export async function fetchContractFiles(
  contractId: string,
  signal?: AbortSignal,
): Promise<InstallmentFile[]> {
  return rowsOf<InstallmentFile>(
    await withSignal(
      supabase
        .from('installment_contract_files')
        .select(INSTALLMENT_FILE_SELECT)
        .eq('contract_id', contractId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(CONTRACT_FILES_CAP),
      signal,
    ),
  )
}

/** A contract's items (0210), in their order. */
export async function fetchContractItems(
  contractId: string,
  signal?: AbortSignal,
): Promise<InstallmentContractItem[]> {
  return rowsOf<InstallmentContractItem>(
    await withSignal(
      supabase
        .from('installment_contract_items')
        .select(INSTALLMENT_ITEM_SELECT)
        .eq('contract_id', contractId)
        .order('position', { ascending: true })
        .limit(CONTRACT_ITEMS_CAP),
      signal,
    ),
  ).map((item) => ({ ...item, quantity: amountOf(item.quantity) }))
}

/** What «تعديل العقد» edits: the summary row, the rows, the units and the
 *  items. */
export async function fetchInstallmentContractForEdit(
  contractId: string,
  signal?: AbortSignal,
): Promise<{
  contract: InstallmentContractRow
  schedule: InstallmentScheduleItem[]
  units: InstallmentUnit[]
  items: InstallmentContractItem[]
  /** The version this edit is based on. */
  editKey: string
} | null> {
  // The key FIRST: a change during the reads then refuses the save, never
  // passes it.
  const key = await withSignal(
    supabase.rpc('installment_contract_edit_key', {
      p_contract_id: contractId,
    }),
    signal,
  )
  if (key.error) throw new SupabaseLoadError()
  if (typeof key.data !== 'string') return null
  const editKey = key.data
  const [contract, schedule, units, items] = await Promise.all([
    fetchContractRow(contractId, signal),
    fetchSchedule(contractId, signal),
    fetchInstallmentContractUnits([contractId], signal),
    fetchContractItems(contractId, signal),
  ])
  return contract ? { contract, schedule, units, items, editKey } : null
}

/**
 * A contract (its summary row) with its schedule, its payments (the newest
 * first), which installments each payment covered and its linked units;
 * null when no row is readable. Throws when a read fails.
 */
export async function fetchInstallmentContract(
  contractId: string,
  signal?: AbortSignal,
): Promise<InstallmentContractDetailData | null> {
  const [contract, schedule, payments, allocations, units, files, items] = await Promise.all([
    fetchContractRow(contractId, signal),
    fetchSchedule(contractId, signal),
    withSignal(
      supabase
        .from('installment_payment_list')
        .select(INSTALLMENT_PAYMENT_SELECT)
        .eq('contract_id', contractId)
        .order('paid_on', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(CONTRACT_PAYMENTS_CAP),
      signal,
    ).then((result) => rowsOf<InstallmentPaymentRow>(result)),
    withSignal(
      supabase
        .from('installment_payment_allocations')
        .select(INSTALLMENT_ALLOCATION_SELECT)
        .eq('installment_schedule.contract_id', contractId)
        .limit(CONTRACT_ALLOCATIONS_CAP),
      signal,
    ).then((result) =>
      rowsOf<AllocationEmbedRow>(result).flatMap((row) =>
        row.installment_schedule
          ? [
              {
                payment_id: row.payment_id,
                amount: amountOf(row.amount),
                seq: row.installment_schedule.seq,
                kind: row.installment_schedule.kind,
                title: row.installment_schedule.title,
              },
            ]
          : [],
      ),
    ),
    fetchInstallmentContractUnits([contractId], signal),
    fetchContractFiles(contractId, signal),
    fetchContractItems(contractId, signal),
  ])
  if (!contract) return null
  return { contract, schedule, payments, allocations, units, files, items }
}

/** What the payment dialog needs of a contract: its totals and its
 *  schedule (the «يوزع على» preview). Null when the contract is gone. */
export async function fetchInstallmentPaymentContext(
  contractId: string,
  signal?: AbortSignal,
): Promise<{
  contract: InstallmentContractRow
  schedule: InstallmentScheduleItem[]
} | null> {
  const [contract, schedule] = await Promise.all([
    fetchContractRow(contractId, signal),
    fetchSchedule(contractId, signal),
  ])
  return contract ? { contract, schedule } : null
}

// --- Selectors (server-side search, 20 at most) -----------------------------------------

/** The ACTIVE contracts a payment can be recorded on. */
export async function loadActiveContractOptions(
  query: string,
): Promise<AsyncSearchSelectOption[]> {
  let request = supabase
    .from('installment_contract_summary')
    .select('id,contract_number,description,financier_name')
    .eq('status', 'active')
    .order('next_due_date', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(INSTALLMENT_OPTION_LIMIT)
  const searchFilter = buildSearchFilter(
    INSTALLMENT_CONTRACT_SEARCH_FIELDS,
    query,
  )
  if (searchFilter) request = request.or(searchFilter)
  return rowsOf<{
    id: string
    contract_number: string
    description: string
    financier_name: string
  }>(await request).map((row) => ({
    value: row.id,
    label: `${row.description} · ${row.contract_number}`,
    description: row.financier_name,
  }))
}

/** The units a contract can be linked to: any unit, by code or type. */
export async function loadInstallmentEquipmentOptions(
  query: string,
): Promise<AsyncSearchSelectOption[]> {
  let request = supabase
    .from('equipment')
    .select('id,code,type')
    .order('code', { ascending: true })
    .limit(INSTALLMENT_OPTION_LIMIT)
  const searchFilter = buildSearchFilter(
    EQUIPMENT_CODE_TYPE_SEARCH_FIELDS,
    query,
  )
  if (searchFilter) request = request.or(searchFilter)
  return rowsOf<{ id: string; code: string; type: string | null }>(
    await request,
  ).map((row) => ({
    value: row.id,
    label: [row.code, row.type].filter(Boolean).join(' '),
  }))
}

// --- Writes of contracts and payments (the four functions) -------------------------------

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

export interface InstallmentContractInput {
  /** Null = a new contract (its number is issued then). */
  id: string | null
  description: string
  financierId: string
  totalAmount: number
  /** «مدفوع قبل التسجيل» (the column keeps its 0203 name). */
  downPayment: number
  balloonAmount: number
  installmentCount: number
  frequencyMonths: number
  /** yyyy-mm-dd; null = waiting for it (0209). */
  firstDueDate: string | null
  /** The version the edit is based on; null for a new contract. */
  expectedKey: string | null
  vat: InstallmentVatPayload
  /** Every row, in its order: a row left out is removed. */
  firstPayments: readonly InstallmentFirstPaymentPayload[]
  notes: string
  /** The linked units' ids; empty = no link. */
  equipmentIds: readonly string[]
  /** 0210: every item, in its order; empty = none. */
  items: readonly InstallmentItemPayload[]
  /** 0208: the contract's own account; both empty = the financier's. */
  bankName: string
  iban: string
}

/**
 * `save_installment_contract`: creates (`id` null) or edits a contract with
 * its generated schedule and its optional units in one transaction. Returns
 * the contract id.
 */
export async function saveInstallmentContract(
  input: InstallmentContractInput,
): Promise<RpcResult<string>> {
  return asResult<string>(
    await supabase.rpc('save_installment_contract', {
      p_id: input.id,
      p_description: input.description.trim(),
      p_financier_id: input.financierId,
      p_total_amount: input.totalAmount,
      p_down_payment: input.downPayment,
      p_balloon_amount: input.balloonAmount,
      p_installment_count: input.installmentCount,
      p_frequency_months: input.frequencyMonths,
      p_first_due_date: input.firstDueDate,
      p_notes: input.notes.trim() || null,
      p_equipment_ids: [...input.equipmentIds],
      // Always sent: an empty object clears the contract's own account.
      p_account: {
        bank_name: input.bankName.trim() || null,
        iban: normalizeIban(input.iban) || null,
      },
      p_vat: input.vat,
      p_first_payments: input.firstPayments,
      p_expected_key: input.expectedKey,
      // 0210: always sent, the whole list.
      p_items: input.items,
    }),
  )
}

/** `set_installment_first_due_date` (0209): divides the installments. */
export async function setInstallmentFirstDueDate(input: {
  contractId: string
  /** yyyy-mm-dd */
  firstDueDate: string
  installmentCount: number
  frequencyMonths: number
}): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('set_installment_first_due_date', {
      p_contract_id: input.contractId,
      p_first_due_date: input.firstDueDate,
      p_installment_count: input.installmentCount,
      p_frequency_months: input.frequencyMonths,
    }),
  )
}

/** `set_installment_payment_date` (0209): dates a first payment or a
 *  separate VAT. */
export async function setInstallmentPaymentDate(
  scheduleId: string,
  dueDate: string,
): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('set_installment_payment_date', {
      p_schedule_id: scheduleId,
      p_due_date: dueDate,
    }),
  )
}

/** The longest installment name (installment_schedule.note). */
export const INSTALLMENT_ROW_NAME_MAX = 200

/** `set_installment_row_note` (0210): names an installment; a blank
 *  clears it. */
export async function setInstallmentRowName(
  scheduleId: string,
  name: string,
): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('set_installment_row_note', {
      p_schedule_id: scheduleId,
      p_note: name.trim() || null,
    }),
  )
}

/** `cancel_installment_contract`: an active contract without a posted
 *  payment, with a required reason. */
export async function cancelInstallmentContract(
  contractId: string,
  reason: string,
): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('cancel_installment_contract', {
      p_contract_id: contractId,
      p_reason: reason.trim(),
    }),
  )
}

/** `delete_installment_contract` (0207): a CANCELLED contract, deleted
 *  for good after its copy to the archive; returns the storage paths of its
 *  receipt files, which the caller removes afterwards. */
export async function deleteInstallmentContract(
  contractId: string,
): Promise<RpcResult<string[]>> {
  const result = asResult<string[] | null>(
    await supabase.rpc('delete_installment_contract', {
      p_contract_id: contractId,
    }),
  )
  if (result.error) return { data: null, error: result.error }
  return { data: result.data ?? [], error: null }
}

export interface InstallmentPaymentInput {
  contractId: string
  /** yyyy-mm-dd, not after the Saudi today. */
  paidOn: string
  amount: number
  method: InstallmentPaymentMethod
  reference: string
  note: string
  /** 0209: the row paid first (a first payment, the VAT row). */
  scheduleId: string | null
}

/** `record_installment_payment`: the database allocates the amount to the
 *  chosen row, then the oldest unpaid rows. Returns the payment id. */
export async function recordInstallmentPayment(
  input: InstallmentPaymentInput,
): Promise<RpcResult<string>> {
  return asResult<string>(
    await supabase.rpc('record_installment_payment', {
      p_contract_id: input.contractId,
      p_paid_on: input.paidOn,
      p_amount: input.amount,
      p_method: input.method,
      p_reference: input.reference.trim() || null,
      p_note: input.note.trim() || null,
      p_schedule_id: input.scheduleId,
    }),
  )
}

/** `void_installment_payment`: takes the payment back with a required
 *  reason; the row stays. */
export async function voidInstallmentPayment(
  paymentId: string,
  reason: string,
): Promise<RpcResult<null>> {
  return asResult<null>(
    await supabase.rpc('void_installment_payment', {
      p_payment_id: paymentId,
      p_reason: reason.trim(),
    }),
  )
}

// --- Writes of the financiers (direct, under RLS) ------------------------------------------

/**
 * A financier write: `refused` when RLS refused it (an insert's 42501, or
 * an update / delete that read back no row), else the database error to
 * map (a duplicate name, a financier that still has contracts).
 */
export type FinancierWriteResult =
  | { ok: true; id: string }
  | { ok: false; refused: boolean; error: PostgresLikeError | null }

function financierResult(result: {
  data: { id: string }[] | null
  error: {
    code?: string
    message: string
    details?: string
    hint?: string
  } | null
}): FinancierWriteResult {
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

/** A financier's fields as the form sends them (0208: the account). */
export interface InstallmentFinancierInput {
  name: string
  bankName: string
  iban: string
}

function financierRow(input: InstallmentFinancierInput) {
  return {
    name: input.name.trim(),
    bank_name: input.bankName.trim() || null,
    iban: normalizeIban(input.iban) || null,
  }
}

export async function insertInstallmentFinancier(
  input: InstallmentFinancierInput,
): Promise<FinancierWriteResult> {
  return financierResult(
    await supabase
      .from('installment_financiers')
      .insert(financierRow(input))
      .select('id'),
  )
}

export async function updateInstallmentFinancier(
  id: string,
  input: InstallmentFinancierInput,
): Promise<FinancierWriteResult> {
  return financierResult(
    await supabase
      .from('installment_financiers')
      .update(financierRow(input))
      .eq('id', id)
      .select('id'),
  )
}

/** The banks list (0177) for the account pickers, 20 at most. */
export const loadInstallmentBankOptions = bankOptionLoader(supabase)

export async function deleteInstallmentFinancier(
  id: string,
): Promise<FinancierWriteResult> {
  return financierResult(
    await supabase
      .from('installment_financiers')
      .delete()
      .eq('id', id)
      .select('id'),
  )
}

// --- The unified page (owner 2026-11-21, the Figma frames «الصفحة الموحدة») ---------------

/** The figures of every contract: the dashboard's financier list, the dues
 *  tab's side cards, the contracts tab's figures and chip counts. */
export const CONTRACT_FIGURES_SELECT =
  'id,financier_id,status,first_due_date,payable_total,paid_overall,remaining_total,overdue_count,last_due_date'
export const CONTRACT_FIGURES_CAP = 5000
/** The calendar reads at most this many rows of one month. */
export const CALENDAR_ROWS_CAP = 1500
/** The dashboard chart reads at most this many rows of the coming year. */
export const CASHFLOW_ROWS_CAP = 2000

export async function fetchContractFigures(signal?: AbortSignal): Promise<{
  rows: ContractFigureRow[]
  partial: boolean
}> {
  const rows = rowsOf<ContractFigureRow>(
    await withSignal(
      supabase
        .from('installment_contract_summary')
        .select(CONTRACT_FIGURES_SELECT)
        .order('id', { ascending: true })
        .limit(CONTRACT_FIGURES_CAP),
      signal,
    ),
  )
  return { rows, partial: rows.length >= CONTRACT_FIGURES_CAP }
}

/** The unpaid rows of the active contracts due from today to `days` ahead,
 *  the nearest first. */
export async function fetchDuesWithin(
  days: number,
  limit: number,
  signal?: AbortSignal,
): Promise<InstallmentDueRow[]> {
  return rowsOf<InstallmentDueRow>(
    await withSignal(
      openDues(INSTALLMENT_DUE_SELECT)
        .gte('days_until_due', 0)
        .lte('days_until_due', days)
        .order('due_date', { ascending: true })
        .order('contract_number', { ascending: true })
        .order('kind', { ascending: true })
        .order('seq', { ascending: true })
        .limit(limit),
      signal,
    ),
  )
}

/** Some contracts' summary rows (the dashboard cards), one read. */
export async function fetchContractsByIds(
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<InstallmentContractRow[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []
  return rowsOf<InstallmentContractRow>(
    await withSignal(
      supabase
        .from('installment_contract_summary')
        .select(INSTALLMENT_CONTRACT_SELECT)
        .in('id', unique)
        .limit(unique.length),
      signal,
    ),
  )
}

/**
 * The chart's rows: what is still to pay from today to the end of the
 * twelve-month window, ONE bounded read; `partial` when the cap was
 * reached (the figures then cover the nearest rows only).
 */
export async function fetchCashflowDues(
  today: string,
  signal?: AbortSignal,
): Promise<{
  rows: { due_date: string; remaining_amount: number }[]
  partial: boolean
}> {
  const rows = rowsOf<{ due_date: string; remaining_amount: number }>(
    await withSignal(
      openDues('due_date,remaining_amount')
        .gte('days_until_due', 0)
        .lt('due_date', cashflowWindowEnd(today))
        .order('due_date', { ascending: true })
        .order('id', { ascending: true })
        .limit(CASHFLOW_ROWS_CAP),
      signal,
    ),
  )
  return { rows, partial: rows.length >= CASHFLOW_ROWS_CAP }
}

/** Every row of the contracts that are not cancelled due in [from, to),
 *  paid or not (the calendar's month), ONE bounded read. */
export async function fetchDuesBetween(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<{ rows: InstallmentDueRow[]; partial: boolean }> {
  const rows = rowsOf<InstallmentDueRow>(
    await withSignal(
      supabase
        .from('installment_dues')
        .select(INSTALLMENT_DUES_LIST_SELECT)
        .in('contract_status', ['active', 'paid_off'])
        .gte('due_date', from)
        .lt('due_date', to)
        .order('due_date', { ascending: true })
        .order('contract_number', { ascending: true })
        .order('kind', { ascending: true })
        .order('seq', { ascending: true })
        .limit(CALENDAR_ROWS_CAP),
      signal,
    ),
  )
  return { rows, partial: rows.length >= CALENDAR_ROWS_CAP }
}

/**
 * One page of the dues tab (design 3): «غير المسدد» = the unpaid rows of
 * the active contracts, the oldest first; «المسدد» = the fully paid rows,
 * the latest paid first; «الكل» = both, by due date. A financier narrows
 * it. Returns the rows and the view's exact count.
 */
export async function fetchDuesFeed(
  query: { view: DuesFeedView; financierId: string | null; limit: number },
  signal?: AbortSignal,
): Promise<{ rows: InstallmentDueRow[]; total: number }> {
  let request =
    query.view === 'open'
      ? openDues(INSTALLMENT_DUES_LIST_SELECT, { count: 'exact' })
      : supabase
          .from('installment_dues')
          .select(INSTALLMENT_DUES_LIST_SELECT, { count: 'exact' })
          .in('contract_status', ['active', 'paid_off'])
  if (query.view === 'paid') request = request.eq('is_paid', true)
  if (query.financierId) request = request.eq('financier_id', query.financierId)
  request =
    query.view === 'paid'
      ? request
          .order('last_paid_on', { ascending: false, nullsFirst: false })
          .order('due_date', { ascending: false })
      : request.order('due_date', { ascending: true })
  const result = await withSignal(
    request
      .order('contract_number', { ascending: true })
      .order('kind', { ascending: true })
      .order('seq', { ascending: true })
      .limit(query.limit),
    signal,
  )
  if (result.error) throw new SupabaseLoadError()
  return {
    rows: (result.data as unknown as InstallmentDueRow[] | null) ?? [],
    total: result.count ?? 0,
  }
}

/**
 * The contract cards (design 4): a chip, the search (number, title,
 * financier), a sort and how many cards are shown. Returns the rows and the
 * chip's exact count.
 */
export async function fetchContractCards(
  query: {
    chip: ContractChip
    search: string
    sort: ContractSort
    limit: number
    today: string
  },
  signal?: AbortSignal,
): Promise<{ rows: InstallmentContractRow[]; total: number }> {
  let request = supabase
    .from('installment_contract_summary')
    .select(INSTALLMENT_CONTRACT_SELECT, { count: 'exact' })
  if (query.chip === 'overdue')
    request = request.eq('status', 'active').gt('overdue_count', 0)
  else if (query.chip === 'awaiting')
    request = request.eq('status', 'active').is('first_due_date', null)
  else if (query.chip === 'ending')
    request = request
      .eq('status', 'active')
      .lte('last_due_date', addDays(query.today, ENDING_SOON_DAYS))
  else if (query.chip === 'paid_off') request = request.eq('status', 'paid_off')
  else if (query.chip === 'cancelled')
    request = request.eq('status', 'cancelled')
  const searchFilter = buildSearchFilter(
    INSTALLMENT_CONTRACT_SEARCH_FIELDS,
    query.search,
  )
  if (searchFilter) request = request.or(searchFilter)
  if (query.sort === 'next_due')
    request = request
      .order('status', { ascending: true })
      .order('next_due_date', { ascending: true, nullsFirst: false })
  else if (query.sort === 'updated')
    request = request.order('updated_at', { ascending: false })
  else if (query.sort === 'remaining')
    request = request.order('remaining_total', { ascending: false })
  else request = request.order('contract_number', { ascending: false })
  const result = await withSignal(
    request.order('id', { ascending: true }).limit(query.limit),
    signal,
  )
  if (result.error) throw new SupabaseLoadError()
  return {
    rows: (result.data as unknown as InstallmentContractRow[] | null) ?? [],
    total: result.count ?? 0,
  }
}
