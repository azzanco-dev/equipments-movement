const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Migration 0213 and its screens (owner 2026-11-25: «1. تعديل تاريخ الحوالة
// 2. تاريخ الاستحقاق بالطريقة الي ذكرتها انت 3. تعديل مبلغ القسط الي تسدد
// 4. بس هذول 5. وابغاك تشيل انشأه, وبيانات المستخدمين في السدادات, يكفي في
// سجل العقد»; the third asked: «مبلغ السداد نفسه»).

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const SQL = read(
  'supabase',
  'migrations',
  '20261125100000_0213_installment_payment_and_due_date_edits.sql',
)
const CODE = SQL.replace(/--[^\n]*/g, '')
const flat = (text) => text.replace(/\s+/g, ' ')
const functionSource = (name) => {
  const match = new RegExp(
    `CREATE FUNCTION public\\.${name}\\(([\\s\\S]*?)\\n\\$\\$;`,
  ).exec(CODE)
  assert.ok(match, name)
  return match[0]
}

test('0213: the two writers are gated, fixed-path definers for authenticated only', () => {
  for (const name of ['update_installment_payment', 'set_installment_due_date']) {
    const body = functionSource(name)
    assert.match(body, /SECURITY DEFINER/, name)
    assert.match(body, /SET search_path = public, pg_temp/, name)
    assert.match(
      body.split('BEGIN').slice(1).join('BEGIN').trimStart(),
      /^PERFORM public\.assert_installments_manage\(\);/,
      name,
    )
  }
  assert.match(
    flat(CODE),
    /REVOKE ALL ON FUNCTION public\.update_installment_payment\(uuid, date, numeric\) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public\.update_installment_payment\(uuid, date, numeric\) TO authenticated;/,
  )
  assert.match(
    flat(CODE),
    /REVOKE ALL ON FUNCTION public\.set_installment_due_date\(uuid, date\) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public\.set_installment_due_date\(uuid, date\) TO authenticated;/,
  )
})

test('0213: a payment edit keeps the rules of a payment', () => {
  const body = flat(functionSource('update_installment_payment'))
  // The contract first, then the payment: the lock order of the writers.
  assert.ok(
    body.indexOf('FROM public.installment_contracts WHERE id = p.contract_id FOR UPDATE') <
      body.indexOf('FROM public.installment_payments WHERE id = p_payment_id FOR UPDATE'),
  )
  assert.match(body, /IF p\.status = 'voided' THEN RAISE EXCEPTION 'payment_already_voided'/)
  assert.match(body, /IF c\.status = 'cancelled' THEN RAISE EXCEPTION 'contract_not_active'/)
  assert.match(body, /p_paid_on > public\.saudi_today\(\) THEN RAISE EXCEPTION 'invalid_paid_on'/)
  // A new amount: taken back, then allocated again, the first row first.
  assert.ok(
    body.indexOf('SET paid_amount = s.paid_amount - a.amount') <
      body.indexOf('DELETE FROM public.installment_payment_allocations WHERE payment_id = p.id'),
  )
  assert.match(body, /CASE WHEN s\.id = v_first THEN 0 ELSE 1 END, s\.due_date NULLS LAST, s\.kind, s\.seq/)
  assert.match(body, /RAISE EXCEPTION 'payment_exceeds_balance'/)
  assert.match(body, /RAISE EXCEPTION 'installments_not_scheduled'/)
  // The contract's state follows, and a separate VAT its day.
  assert.match(body, /SET status = 'paid_off', closed_at = now\(\)/)
  assert.match(body, /SET status = 'active', closed_at = NULL/)
  assert.match(body, /PERFORM public\.sync_installment_vat_row\(c\.id\)/)
  assert.match(body, /SET paid_on = p_paid_on, amount = v_amount, edited_at = now\(\), edited_by = auth\.uid\(\)/)
})

test('0213: an installment that is not fully paid takes a new due day', () => {
  const body = flat(functionSource('set_installment_due_date'))
  assert.match(body, /WHERE id = p_schedule_id AND kind = 'installment'/)
  assert.match(body, /IF c\.status <> 'active' THEN RAISE EXCEPTION 'contract_not_active'/)
  assert.match(body, /IF v_row\.paid_amount >= v_row\.amount THEN RAISE EXCEPTION 'installment_already_paid'/)
  assert.match(body, /due_date_edited_by = auth\.uid\(\)/)
  // The payments list names who edited it last.
  assert.match(CODE, /LEFT JOIN public\.profile_names eb ON eb\.id = p\.edited_by;/)
  assert.match(CODE, /security_invoker = true/)
})

test('the screens: the two dialogs, the card, the facts', () => {
  const dialogs = read('src', 'components', 'installments', 'InstallmentEditDialogs.tsx')
  assert.match(dialogs, /await updateInstallmentPayment\(payment\.id, date, parsed\)/)
  assert.match(dialogs, /await setInstallmentDueDate\(row\.id, date\)/)
  assert.match(dialogs, /max=\{today\}/)
  const table = read('src', 'components', 'installments', 'ContractPaymentTable.tsx')
  assert.match(table, /const canMoveDue = canAct && !paid && row\.kind === 'installment'/)
  const page = read('src', 'screens', 'installments', 'InstallmentContractDetail.tsx')
  assert.match(page, /onEdit=\{\(\) => open\(\{ kind: 'edit_payment', payment \}\)\}/)
  assert.match(page, /onEditDueDate=\{\(row\) => open\(\{ kind: 'due_date', row \}\)\}/)
  // «شيل انشاه, وبيانات المستخدمين في السدادات»: the history names them.
  assert.doesNotMatch(page, /instCreatedBy|payment\.created_by_name|payment\.voided_by_name/)
  const view = read('src', 'lib', 'installmentsView.ts')
  assert.match(view, /kind: 'payment_edited'/)
  assert.match(view, /kind: 'due_date_edited'/)
  const translations = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...translations.matchAll(
      /\/\/ installment-edits \(0213\)\n([\s\S]*?)\/\/ end installment-edits \(0213\)/g,
    ),
  ]
  assert.equal(blocks.length, 2)
  assert.doesNotMatch(blocks[0][1], /[أإآ]/)
  const keys = (block) => [...block.matchAll(/^\s+([A-Za-z]+):/gm)].map((m) => m[1])
  assert.deepEqual(keys(blocks[0][1]), keys(blocks[1][1]))
})
