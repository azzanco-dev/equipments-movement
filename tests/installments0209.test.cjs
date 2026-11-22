const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0209 (owner 2026-11-22): first payments, a first due date that
// may be unknown, the VAT inside one typed total, the contract's
// files, and the screens on them.

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')
const SQL = read(
  'supabase',
  'migrations',
  '20261122100000_0209_installment_first_payments_vat_files.sql',
)
const CODE = SQL.replace(/--[^\n]*/g, '')
const FLAT = CODE.replace(/\s+/g, ' ')
const bodyOf = (name) => {
  const start = FLAT.indexOf(`FUNCTION public.${name}(`, FLAT.search(
    new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\(`),
  ))
  assert.ok(start >= 0, name)
  return FLAT.slice(start, FLAT.indexOf('$$;', start))
}

test('0209: nothing earlier moves', () => {
  assert.match(FLAT, /vat_mode text NOT NULL DEFAULT 'unspecified'/)
  assert.match(FLAT, /vat_amount numeric\(14, 2\) NOT NULL DEFAULT 0/)
  assert.match(FLAT, /kind text NOT NULL DEFAULT 'installment'/)
  // «اخر تعديل» of the earlier contracts stays.
  assert.ok(
    FLAT.indexOf('DISABLE TRIGGER installment_contracts_updated_at') <
      FLAT.indexOf('ENABLE TRIGGER installment_contracts_updated_at'),
  )
  assert.match(CODE, /RAISE EXCEPTION '0209: a contract does not add up after the backfill'/)
  // The down payment is never turned into a first payment.
  assert.doesNotMatch(FLAT, /DROP COLUMN|RENAME COLUMN/)
  // The earlier shape rules still hold: they are not dropped.
  assert.doesNotMatch(FLAT, /DROP CONSTRAINT installment_contracts_/)
})

test('0209: every writer checks the key first and is closed to anon', () => {
  for (const name of [
    'save_installment_contract',
    'record_installment_payment',
    'set_installment_first_due_date',
    'set_installment_payment_date',
    'add_installment_contract_file',
    'remove_installment_contract_file',
    'delete_installment_contract',
  ]) {
    const body = bodyOf(name)
    assert.match(body, /SECURITY DEFINER SET search_path = public, pg_temp/, name)
    assert.match(body, /BEGIN PERFORM public\.assert_installments_manage\(\);/, name)
  }
  for (const name of [
    'save_installment_contract',
    'record_installment_payment',
    'set_installment_first_due_date',
    'set_installment_payment_date',
    'add_installment_contract_file',
    'remove_installment_contract_file',
  ]) {
    assert.match(
      FLAT,
      new RegExp(`REVOKE ALL ON FUNCTION public\.${name}\([^;]*\) FROM PUBLIC, anon`),
      name,
    )
    assert.match(
      FLAT,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\.${name}\([^;]*\) TO authenticated;`),
      name,
    )
  }
  assert.doesNotMatch(FLAT, /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*installment_contract_files/)
})

test('0209: a first payment is payable before the division', () => {
  const body = bodyOf('record_installment_payment')
  assert.match(body, /RAISE EXCEPTION 'installments_not_scheduled'/)
  // A waiting contract never closes on the payment of its rows.
  assert.match(body, /IF v_amount = v_open AND c\.first_due_date IS NOT NULL THEN/)
  assert.match(
    body,
    /ORDER BY CASE WHEN s\.id = p_schedule_id THEN 0 ELSE 1 END, s\.due_date NULLS LAST, s\.kind, s\.seq/,
  )
})

test('0209: what money on a row fixes', () => {
  const body = bodyOf('save_installment_contract')
  assert.match(body, /IF v_base <> v_old\.amount OR v_paid_on IS NOT NULL THEN RAISE EXCEPTION 'first_payment_locked'/)
  assert.match(body, /s\.kind = 'installment' AND s\.paid_amount > 0 \) THEN RAISE EXCEPTION 'contract_has_payments'/)
  assert.match(body, /IF v_vat_row\.paid_amount > 0 THEN IF v_vat_mode <> 'separate' OR v_vat <> v_vat_row\.amount OR v_vat_paid_on IS NOT NULL THEN RAISE EXCEPTION 'contract_has_payments'/)
  // «مدفوعة» is an ordinary payment.
  assert.match(body, /PERFORM public\.record_installment_payment\(/)
  // «غير محدد» is never a choice.
  assert.match(body, /IF v_vat_mode = 'unspecified' AND \(v_new OR c\.vat_mode <> 'unspecified'\)/)
})

test('0209: the files: private, 5 MB, read by the view key', () => {
  assert.match(FLAT, /'installment-contract-files', 'installment-contract-files', false, 5242880/)
  assert.match(FLAT, /size_bytes BETWEEN 1 AND 5242880/)
  assert.match(
    FLAT,
    /ON public\.installment_contract_files FOR SELECT TO authenticated USING \(\(SELECT public\.has_permission\('installments\.view'\)\)\)/,
  )
  assert.match(FLAT, /installment_contract_files_updated_at BEFORE UPDATE/)
  assert.match(bodyOf('delete_installment_contract'), /installment_contract_files/)
})

test('0209: the readers stay security invoker', () => {
  for (const view of [
    'installment_dues',
    'installment_contract_summary',
    'installment_overview',
  ])
    assert.match(
      FLAT,
      new RegExp(
        `CREATE OR REPLACE VIEW public\\.${view} WITH \\(security_invoker = true\\)`,
      ),
      view,
    )
})

test('the files client: the limit, and an order that leaves no row without its file', () => {
  const rules = read('src', 'lib', 'installmentFiles.ts')
  assert.match(rules, /INSTALLMENT_FILE_MAX_BYTES = 5 \* 1024 \* 1024/)
  assert.match(rules, /INSTALLMENT_FILES_BUCKET = 'installment-contract-files'/)
  const data = read('src', 'lib', 'installmentFilesData.ts')
  const upload = data.indexOf('.upload(path, file')
  const add = data.indexOf(".rpc('add_installment_contract_file'")
  const undo = data.indexOf('await removeInstallmentFileObjects([path])')
  assert.ok(upload > 0 && upload < add && add < undo)
  const rowFirst = data.indexOf("'remove_installment_contract_file'")
  assert.ok(rowFirst < data.indexOf('await removeInstallmentFileObjects([data])'))
  // A signed link, never a public one.
  assert.match(data, /createSignedUrl\(file\.storage_path, 300\)/)
  assert.doesNotMatch(data, /getPublicUrl|\.(insert|update|upsert)\(/)
})

test('deleting a contract reads its file paths before their rows go', () => {
  const page = read('src', 'screens', 'installments', 'InstallmentContractDetail.tsx')
  assert.ok(
    page.indexOf('await fetchContractFiles(contract.id)') <
      page.indexOf('await deleteInstallmentContract(contract.id)'),
  )
  assert.match(page, /removeInstallmentFileObjects\(filePaths\)/)
})

test('the payment goes to the row it was opened on', () => {
  const list = read('src', 'screens', 'installments', 'InstallmentsScreen.tsx')
  assert.match(list, /targetId: row\.kind === 'installment' \? undefined : row\.id/)
  const pay = read('src', 'components', 'installments', 'InstallmentPaymentDialog.tsx')
  // The row asked for, never «the oldest» in its place.
  assert.match(pay, /scheduleId: target,/)
  assert.doesNotMatch(pay, /scheduleId: chosen/)
  assert.match(pay, /if \(!ready \|\| targetGone\) return/)
  assert.match(pay, /disabled=\{targetGone \|\| \(!!values\.contract_id && !ready\)\}/)
})

test('the 0209 copy: both languages, plain alif', () => {
  const blocks = [
    ...read('src', 'i18n', 'translations.ts').matchAll(
      /\/\/ installments-plan \(0209\)\n([\s\S]*?)\/\/ end installments-plan \(0209\)/g,
    ),
  ].map((match) => match[1])
  assert.equal(blocks.length, 2)
  const keys = (block) =>
    [...block.matchAll(/^\s+([A-Za-z0-9_]+):/gm)].map((match) => match[1])
  assert.deepEqual(keys(blocks[0]), keys(blocks[1]))
  assert.doesNotMatch(blocks[0], /[أإآ]/)
})

test('0209: an edit over a changed contract is refused', () => {
  const save = bodyOf('save_installment_contract')
  assert.match(save, /RAISE EXCEPTION 'contract_changed'/)
  // After the row lock, before anything is written.
  assert.ok(save.indexOf('FOR UPDATE') < save.indexOf("'contract_changed'"))
  assert.ok(save.indexOf("'contract_changed'") < save.indexOf('UPDATE public.installment_contracts'))
  const key = bodyOf('installment_contract_edit_key')
  assert.match(key, /SECURITY INVOKER/)
  assert.match(key, /to_jsonb\(c\) - 'updated_at'/)
  const data = read('src', 'lib', 'installmentsData.ts')
  const loader = data.slice(data.indexOf('export async function fetchInstallmentContractForEdit'))
  // The key is read before the rows it vouches for.
  assert.ok(loader.indexOf('installment_contract_edit_key') < loader.indexOf('fetchContractRow('))
  assert.match(
    read('src', 'screens', 'installments', 'InstallmentContractFormScreen.tsx'),
    /expectedKey: stored\?\.editKey \?\? null/,
  )
})

test('0209: paid rows are recorded last, and the agreed day stays', () => {
  const save = bodyOf('save_installment_contract')
  // No day is invented for a row that had none: a void would make it late.
  assert.doesNotMatch(save, /COALESCE\(v_due, v_paid_on\)/)
  assert.ok(
    save.indexOf('INSERT INTO public.installment_schedule') <
      save.indexOf('FROM jsonb_array_elements(v_payments)'),
  )
  assert.match(save, /WHEN p_first_due_date IS NULL THEN NULL/)
  // A partly paid VAT row's day follows the installments.
  assert.match(
    bodyOf('sync_installment_vat_row'),
    /WHERE id = v_row\.id AND paid_amount < amount AND due_date IS DISTINCT FROM v_due/,
  )
})

test('0209: one typed total, the VAT inside it', () => {
  assert.match(FLAT, /vat_mode IN \('unspecified', 'none', 'inside', 'separate'\)/)
  const save = bodyOf('save_installment_contract')
  assert.match(save, /IF v_vat_mode = 'inside' THEN v_vat := round\(v_total \* 15 \/ 115, 2\);/)
  assert.match(save, /v_rate_base := v_total - CASE WHEN v_vat_mode = 'separate' THEN v_vat ELSE 0 END;/)
  assert.match(save, /v_installments := v_rate_base - v_prepaid - v_first_total;/)
  // Nothing is ever added on top of the typed total.
  assert.doesNotMatch(FLAT, /total_amount \+ |v_total \+ /)
  assert.doesNotMatch(FLAT, /installment_with_vat|vat_timing/)
  assert.match(FLAT, /c\.total_amount AS payable_total/)
})

test('0209: a separate VAT is payable without a day, before the division', () => {
  assert.match(FLAT, /CHECK \(due_date IS NOT NULL OR kind <> 'installment'\)/)
  const sync = bodyOf('sync_installment_vat_row')
  // The row is there whether it has a day or not.
  assert.doesNotMatch(sync, /IF v_due IS NULL THEN/)
  assert.match(sync, /IF c\.vat_mode <> 'separate' THEN DELETE/)
  assert.match(bodyOf('set_installment_payment_date'), /kind IN \('first_payment', 'vat'\)/)
  const save = bodyOf('save_installment_contract')
  assert.match(save, /IF v_vat_paid_on IS NOT NULL THEN v_payments :=/)
  // A paid installment still allows none <-> inside: no amount moves.
  assert.match(save, /OR \(v_vat_mode = 'separate'\) <> \(c\.vat_mode = 'separate'\)/)
})

test('the form asks one question and types one total', () => {
  const form = read('src', 'screens', 'installments', 'InstallmentContractFormScreen.tsx')
  assert.equal([...form.matchAll(/name="vat_mode"/g)].length, 1)
  assert.doesNotMatch(form, /vat_timing|instBeforeVatHint/)
  const row = read('src', 'components', 'installments', 'InstallmentVatRow.tsx')
  // «مدفوعة» hides the planned day.
  assert.match(row, /const showDue = !paidNow && !settled/)
  const page = read('src', 'screens', 'installments', 'InstallmentContractDetail.tsx')
  // Above the schedule: it is not always at the end.
  assert.ok(page.indexOf('<VatPaymentCard') < page.indexOf("t('instScheduleTitle')"))
})

test('0209: a void puts the VAT back on its chosen day', () => {
  const body = bodyOf('void_installment_payment')
  assert.match(body, /BEGIN PERFORM public\.assert_installments_manage\(\);/)
  assert.ok(
    body.indexOf('SET paid_amount = s.paid_amount - a.amount') <
      body.indexOf('PERFORM public.sync_installment_vat_row(c.id)'),
  )
  // A paid VAT no longer stretches the contract's end.
  assert.match(FLAT, /WHERE s\.kind = 'installment' OR \(s\.kind = 'vat' AND s\.paid_amount < s\.amount\) \) AS last_due_date/)
})

test('the VAT field compares amounts, not their spelling', () => {
  const row = read('src', 'components', 'installments', 'InstallmentVatRow.tsx')
  assert.doesNotMatch(row, /text === automatic/)
  assert.match(row, /toHalalas\(typed\) === toHalalas\(Number\(automatic\)\)/)
})
