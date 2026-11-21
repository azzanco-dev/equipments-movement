const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 0207 (owner 2026-11-21): deleting a CANCELLED installment contract with its
// archive copy, the payment date of a paid row, and the screens: «المسددة»,
// «هذا الشهر» by default, the «القسط» column, the dashboard's one table and
// «حذف العقد» on a cancelled contract.

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')
const SQL = read(
  'supabase',
  'migrations',
  '20261121100000_0207_installment_delete_and_paid_on.sql',
)
const CODE = SQL.replace(/--[^\n]*/g, '')
const FLAT = CODE.replace(/\s+/g, ' ')

test('0207: the delete is a guarded SECURITY DEFINER function', () => {
  assert.match(
    FLAT,
    /CREATE OR REPLACE FUNCTION public\.delete_installment_contract\(p_contract_id uuid\) RETURNS text\[\] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp/,
  )
  const body = FLAT.slice(FLAT.indexOf('delete_installment_contract(p_contract_id uuid)'))
  // The key first, the row lock, then the state.
  assert.ok(
    body.indexOf('assert_installments_manage()') < body.indexOf('FOR UPDATE'),
  )
  assert.match(body, /IF c\.status <> 'cancelled' THEN RAISE EXCEPTION 'contract_not_cancelled' USING ERRCODE = '55000'/)
  assert.match(body, /p\.status = 'posted' \) THEN RAISE EXCEPTION 'contract_has_payments'/)
  // The archive is written before anything is deleted.
  assert.ok(
    body.indexOf('INSERT INTO public.installment_contract_deletions') <
      body.indexOf('DELETE FROM public.installment_payment_receipts'),
  )
  // Receipts (RESTRICT) before payments, before the contract.
  const order = [
    'DELETE FROM public.installment_payment_receipts',
    'DELETE FROM public.installment_payments',
    'DELETE FROM public.installment_contract_equipment',
    'DELETE FROM public.installment_contracts',
  ].map((piece) => body.indexOf(piece))
  assert.deepEqual([...order].sort((a, b) => a - b), order)
  assert.ok(order.every((index) => index > 0))
  assert.match(FLAT, /REVOKE ALL ON FUNCTION public\.delete_installment_contract\(uuid\) FROM PUBLIC, anon;/)
  assert.match(FLAT, /GRANT EXECUTE ON FUNCTION public\.delete_installment_contract\(uuid\) TO authenticated;/)
})

test('0207: the archive is append-only and read by installments.view', () => {
  const table = FLAT.slice(
    FLAT.indexOf('CREATE TABLE public.installment_contract_deletions'),
    FLAT.indexOf('COMMENT ON TABLE public.installment_contract_deletions'),
  )
  assert.doesNotMatch(table, /REFERENCES/)
  assert.doesNotMatch(table, /updated_at/)
  assert.match(FLAT, /ALTER TABLE public\.installment_contract_deletions ENABLE ROW LEVEL SECURITY/)
  assert.match(FLAT, /FOR SELECT TO authenticated USING \(\(SELECT public\.has_permission\('installments\.view'\)\)\)/)
  assert.match(FLAT, /GRANT SELECT ON TABLE public\.installment_contract_deletions TO authenticated;/)
  assert.doesNotMatch(FLAT, /GRANT (INSERT|UPDATE|DELETE)/)
})

test('0207: installment_dues keeps its columns and appends last_paid_on', () => {
  const view = FLAT.slice(
    FLAT.indexOf('CREATE OR REPLACE VIEW public.installment_dues'),
    FLAT.indexOf('COMMENT ON VIEW public.installment_dues'),
  )
  assert.match(view, /security_invoker = true/)
  assert.match(
    view,
    /s\.due_date - public\.saudi_today\(\) AS days_until_due, \( SELECT max\(p\.paid_on\)/,
  )
  assert.match(view, /p\.status = 'posted' \) AS last_paid_on FROM/)
})

test('the dues: «المسددة», «هذا الشهر» by default, «القسط» column', () => {
  const view = read('src', 'lib', 'installmentsView.ts')
  assert.match(view, /export const DEFAULT_DUES_VIEW: InstallmentDuesView = 'month'/)
  assert.match(view, /paid: 'instDuesViewPaid'/)
  const data = read('src', 'lib', 'installmentsData.ts')
  // «المسددة»: fully paid rows of contracts that are not cancelled.
  assert.match(
    data,
    /\.in\('contract_status', \['active', 'paid_off'\]\)\s*\.eq\('is_paid', true\)/,
  )
  assert.match(data, /sort = 'last_paid_on'\s*ascending = false/)
  assert.match(data, /paid \? row\.amount : row\.remaining_amount/)
  assert.match(data, /INSTALLMENT_DUES_LIST_SELECT = `\$\{INSTALLMENT_DUE_SELECT\},last_paid_on`/)
  const tab = read('src', 'components', 'installments', 'InstallmentsDuesTab.tsx')
  assert.match(tab, /state\.duesView \?\? DEFAULT_DUES_VIEW/)
  assert.match(tab, /key: 'amount',\s*header: t\('instInstallment'\)/)
  assert.match(tab, /header: t\('instInstallmentNo'\)/)
  assert.match(tab, /key: 'last_paid_on'/)
  assert.match(tab, /canManage && !paidView/)
  assert.doesNotMatch(tab, /header: t\('instRemaining'\)/)
  const configs = read('src', 'lib', 'listConfigs.ts')
  assert.match(configs, /\{ key: 'amount', label: 'instInstallment' \}/)
})

test('the dashboard keeps the 30-day table alone', () => {
  const dashboard = read('src', 'components', 'installments', 'InstallmentsDashboardTab.tsx')
  assert.doesNotMatch(dashboard, /instCashflowTitle|instOverdueListTitle|CashflowBars/)
  assert.match(dashboard, /title=\{t\('instUpcomingTitle'\)\}/)
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'components', 'installments', 'CashflowBars.tsx')))
})

test('«حذف العقد»: a cancelled contract only, confirmed, then its files', () => {
  const page = read('src', 'screens', 'installments', 'InstallmentContractDetail.tsx')
  assert.match(page, /\{cancelled && \(\s*<DropdownMenuItem\s+icon=\{<Trash2 size=\{14\} \/>\}\s+tone="danger"/)
  assert.match(page, /tone: 'danger',\s*\}\)\s*if \(!confirmed\) return/)
  assert.ok(
    page.indexOf('await deleteInstallmentContract(contract.id)') <
      page.indexOf('await removeInstallmentReceiptFiles(result.data)'),
  )
  assert.match(page, /onDeleted\(\)/)
  assert.match(read('src', 'App.tsx'), /onDeleted=\{\(\) => router\.replace\('\/installments\?tab=contracts'\)\}/)
  assert.match(read('src', 'lib', 'installments.ts'), /contract_not_cancelled: 'instErrContractNotCancelled'/)
  const translations = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...translations.matchAll(
      /\/\/ installments-delete-paid \(0207\)\n([\s\S]*?)\/\/ end installments-delete-paid \(0207\)/g,
    ),
  ]
  assert.equal(blocks.length, 2)
  assert.doesNotMatch(blocks[0][1], /[أإآ]/)
  const keys = [...blocks[0][1].matchAll(/^\s+([A-Za-z]+):/gm)].map((m) => m[1])
  const english = [...blocks[1][1].matchAll(/^\s+([A-Za-z]+):/gm)].map((m) => m[1])
  assert.deepEqual(keys, english)
})

test('the tabs follow the approved design «نموذج 5»', () => {
  const page = read('src', 'screens', 'installments', 'InstallmentsScreen.tsx')
  assert.match(page, /<TabsList variant="buttons" aria-label=\{t\('instTabsLabel'\)\}>/)
  for (const icon of ['LayoutDashboard', 'FileText', 'CalendarDays', 'Building2'])
    assert.ok(page.includes(`<${icon} size={16} aria-hidden="true" />`), icon)
  const dues = read('src', 'components', 'installments', 'InstallmentsDuesTab.tsx')
  assert.match(dues, /<TabsList variant="chips" aria-label=\{t\('instTabDues'\)\}>/)
  assert.match(dues, /INSTALLMENT_DUES_VIEW_TONES\[value\]/)
  const view = read('src', 'lib', 'installmentsView.ts')
  assert.match(
    view,
    /overdue: 'danger',\s*month: 'warning',\s*next30: 'info',\s*all: 'neutral',\s*paid: 'success',/,
  )
  const tabs = read('src', 'components', 'ui', 'Tabs.tsx')
  assert.match(tabs, /export type TabsVariant = 'underline' \| 'segmented' \| 'buttons' \| 'chips'/)
})
