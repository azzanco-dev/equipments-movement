const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Migration 0210 (owner 2026-11-23): what an installment contract covers
// («البنود», free text with a count) and a name on each installment
// («القسط 1 - رقم سند الامر 545456564»), with the screens that use them.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const SQL = read('supabase', 'migrations', '20261123100000_0210_installment_items_and_names.sql')
const PLAN_SQL = read('supabase', 'migrations', '20261122100000_0209_installment_first_payments_vat_files.sql')
const CODE = SQL.replace(/--[^\n]*/g, '')

function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const exports = {}
  cache.set(name, exports)
  vm.runInNewContext(
    code,
    {
      exports,
      Date,
      Math,
      Number,
      String,
      Array,
      Map,
      Set,
      BigInt,
      Intl,
      URLSearchParams,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const plan = loadLibModule('installmentPlan')
const view = loadLibModule('installmentsView')
const reminder = loadLibModule('installmentReminder')
const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

/** A function's body, from its CREATE to the `$$;` that closes it. */
function body(source, header) {
  const start = source.indexOf(header)
  assert.ok(start >= 0, header)
  const end = source.indexOf('$$;\n', start)
  return source.slice(start, end)
}

test('0210 is the latest migration and comes after 0209', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()
  const index = files.indexOf('20261123100000_0210_installment_items_and_names.sql')
  assert.ok(index > files.indexOf('20261122100000_0209_installment_first_payments_vat_files.sql'))
})

test('0210: the save is 0209 verbatim plus p_items', () => {
  const before = body(PLAN_SQL, 'CREATE FUNCTION public.save_installment_contract(')
  let after = body(SQL, 'CREATE FUNCTION public.save_installment_contract(')
  // Take out exactly what 0210 adds: the parameter, three variables, the
  // check block and the write block.
  after = after
    .replace(
      /,\n  -- 0210: \[\{name, quantity\}\][^\n]*\n[^\n]*\n  p_items jsonb DEFAULT NULL\n\)/,
      '\n)',
    )
    .replace('  v_items jsonb;\n  v_item_name text;\n  v_item_qty numeric;\n', '')
    .replace(/\n  -- 0210: what the contract covers[\s\S]*?\n  END IF;\n(?=\n  -- VAT)/, '')
    .replace(/\n  -- 0210: the items, replaced whole when sent\.[\s\S]*?\n  END IF;\n/, '')
  assert.equal(after, before)
  // The fifteen-parameter function goes, the new one is the only one.
  assert.match(
    SQL,
    /DROP FUNCTION public\.save_installment_contract\(\n  uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid\[\], jsonb, jsonb, jsonb, text\n\);/,
  )
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\.save_installment_contract\([^)]*, jsonb\)\n  TO authenticated;/)
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.save_installment_contract\([^)]*, jsonb\)\n  FROM PUBLIC, anon, authenticated;/)
})

test('0210: the items are checked before anything is written, then replaced whole', () => {
  const save = body(SQL, 'CREATE FUNCTION public.save_installment_contract(')
  const check = save.indexOf("RAISE EXCEPTION 'invalid_items'")
  const firstWrite = save.search(/INSERT INTO public\.installment_contracts|UPDATE public\.installment_contracts/)
  assert.ok(check > 0 && check < firstWrite)
  for (const token of ['invalid_items', 'invalid_item_name', 'invalid_item_quantity'])
    assert.match(save, new RegExp(`'${token}' USING ERRCODE = '22023'`))
  assert.match(save, /char_length\(v_item_name\) > 120/)
  assert.match(save, /v_item_qty <= 0 OR v_item_qty > 99999999\.99 OR v_item_qty <> round\(v_item_qty, 2\)/)
  assert.match(save, /jsonb_array_length\(p_items\) > 100/)
  // SQL NULL keeps the items; an array replaces them.
  assert.match(save, /IF v_items IS NOT NULL THEN\n    DELETE FROM public\.installment_contract_items WHERE contract_id = v_id;/)
})

test('0210: the items table is read by installments.view and written by nobody', () => {
  const table = /CREATE TABLE public\.installment_contract_items \(([\s\S]*?)\n\);/.exec(SQL)[1]
  assert.match(table, /REFERENCES public\.installment_contracts\(id\) ON DELETE CASCADE/)
  assert.match(table, /char_length\(name\) BETWEEN 1 AND 120/)
  assert.match(table, /quantity numeric\(10, 2\) NOT NULL/)
  assert.match(table, /CHECK \(quantity > 0\)/)
  assert.match(table, /updated_at timestamptz NOT NULL DEFAULT now\(\)/)
  assert.match(SQL, /CREATE TRIGGER installment_contract_items_updated_at\n  BEFORE UPDATE ON public\.installment_contract_items/)
  assert.match(SQL, /ALTER TABLE public\.installment_contract_items ENABLE ROW LEVEL SECURITY;/)
  assert.match(SQL, /FOR SELECT TO authenticated\n  USING \(\(SELECT public\.has_permission\('installments\.view'\)\)\);/)
  assert.match(SQL, /REVOKE ALL ON TABLE public\.installment_contract_items FROM PUBLIC, anon, authenticated;\nGRANT SELECT ON TABLE public\.installment_contract_items TO authenticated;/)
  assert.doesNotMatch(CODE, /CREATE POLICY [a-z_]+ ON public\.installment_contract_items\s+FOR (INSERT|UPDATE|DELETE|ALL)/)
})

test('0210: an installment may carry a name, kept by number on a rebuild', () => {
  assert.match(SQL, /ELSE title IS NULL AND rate IS NULL\n/)
  const generate = body(SQL, 'CREATE OR REPLACE FUNCTION public.generate_installment_schedule(')
  const keep = generate.indexOf('jsonb_object_agg(s.seq::text, s.note)')
  const remove = generate.indexOf('DELETE FROM public.installment_schedule')
  assert.ok(keep > 0 && keep < remove)
  assert.match(generate, /v_notes->>v_i::text/)
  // The rest of the rebuild is 0209's.
  const old = body(PLAN_SQL, 'CREATE OR REPLACE FUNCTION public.generate_installment_schedule(')
  assert.match(old, /v_i > v_regular_count\n    \);/)
  assert.match(generate, /v_i > v_regular_count,\n      v_notes->>v_i::text\n    \);/)
})

test('0210: set_installment_row_note is guarded, locked and closed to anon', () => {
  const fn = body(SQL, 'CREATE FUNCTION public.set_installment_row_note(')
  assert.match(fn, /SECURITY DEFINER\nSET search_path = public, pg_temp/)
  assert.ok(fn.indexOf('assert_installments_manage()') < fn.indexOf('SELECT * INTO v_row'))
  assert.match(fn, /kind = 'installment'/)
  assert.match(fn, /'invalid_schedule_row'/)
  assert.match(fn, /char_length\(v_note\) > 200/)
  assert.match(fn, /c\.status = 'cancelled'[\s\S]*'contract_not_active'/)
  // The contract first, then the row: the lock order of the other writers.
  assert.ok(
    fn.indexOf('FROM public.installment_contracts WHERE id = v_row.contract_id FOR UPDATE') <
      fn.indexOf('FROM public.installment_schedule WHERE id = p_schedule_id FOR UPDATE'),
  )
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.set_installment_row_note\(uuid, text\) FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public\.set_installment_row_note\(uuid, text\) TO authenticated;/)
})

test('0210: the readers carry the name; the key the items; the archive both', () => {
  assert.match(SQL, /CREATE OR REPLACE VIEW public\.installment_dues\nWITH \(security_invoker = true\) AS[\s\S]*  s\.title,\n  s\.note\nFROM/)
  const key = body(SQL, 'CREATE OR REPLACE FUNCTION public.installment_contract_edit_key(')
  assert.match(key, /'items', \(/)
  // The installments themselves stay out of the key: naming one never
  // refuses an open edit.
  assert.match(key, /s\.kind <> 'installment'/)
  assert.match(SQL, /ADD COLUMN items jsonb NOT NULL DEFAULT '\[\]'::jsonb;/)
  assert.match(SQL, /equipment, receipts, files, items, deleted_by, deleted_by_name/)
  assert.match(SQL, /'note', d\.note,/)
})

test('the item rows of the form', () => {
  assert.equal(plan.itemRowError({ name: '  ', quantity: 'x' }), null)
  assert.equal(plan.itemRowError({ name: 'حفار', quantity: '2' }), null)
  assert.equal(plan.itemRowError({ name: 'حفار', quantity: '0' }), 'instItemErrQuantity')
  assert.equal(plan.itemRowError({ name: 'حفار', quantity: '1.234' }), 'instItemErrQuantity')
  assert.equal(plan.itemRowError({ name: 'حفار', quantity: '١٫٥' }), 'instItemErrQuantity')
  assert.equal(plan.itemRowError({ name: 'حفار', quantity: '٢' }), null)
  assert.equal(plan.itemRowError({ name: 'a'.repeat(121), quantity: '1' }), 'instItemErrName')
  assert.deepEqual(
    plain(
      plan.itemsPayload([
        { key: 'a', name: '  حفار كات 320 ', quantity: '2' },
        { key: 'b', name: '', quantity: '1' },
        { key: 'c', name: 'مولد', quantity: '1.5' },
      ]),
    ),
    [
      { name: 'حفار كات 320', quantity: 2 },
      { name: 'مولد', quantity: 1.5 },
    ],
  )
  assert.equal(plan.newItemRow('k').quantity, '1')
  assert.equal(plan.formatItemQuantity(2), '2')
  assert.equal(plan.formatItemQuantity(1.5), '1.5')
  assert.equal(plan.INSTALLMENT_ITEM_NAME_MAX, 120)
  assert.equal(plan.INSTALLMENT_ITEMS_MAX, 100)
})

test('an installment is called by its number, then its name', () => {
  const t = (key) =>
    ({
      instInstallmentN: 'القسط {seq}',
      instCardSeqOf: 'القسط {seq} من {count}',
      instFirstPayment: 'دفعة',
      instVatPayment: 'دفعة الضريبة',
    })[key] ?? key
  assert.equal(
    view.payableRowLabel({ seq: 1, kind: 'installment', note: 'رقم سند الامر 545456564' }, t),
    'القسط 1 - رقم سند الامر 545456564',
  )
  assert.equal(view.payableRowLabel({ seq: 3, kind: 'installment', note: '  ' }, t, 24), 'القسط 3 من 24')
  // A first payment's note is not its name.
  assert.equal(
    view.payableRowLabel({ seq: 1, kind: 'first_payment', title: 'المقدم', note: 'شيك' }, t),
    'المقدم',
  )
})

test('the reminder names an installment that has a name', () => {
  const payload = reminder.parseInstallmentReminder({
    day: '2026-11-23',
    items: [
      {
        bucket: 'tomorrow',
        contract_number: 'INS-0003',
        description: 'شيول',
        financier_name: 'بنك',
        seq: 4,
        kind: 'installment',
        title: null,
        note: 'سند 545456564',
        due_date: '2026-11-24',
        remaining_amount: 1000,
        days_until_due: 1,
      },
    ],
    recipients: [],
    skipped: 0,
  })
  assert.equal(payload.items[0].note, 'سند 545456564')
  const [line] = reminder.reminderSectionLines(payload.items, 'tomorrow')
  assert.deepEqual(plain(line.installmentNames), ['القسط 4: سند 545456564'])
  const text = reminder.buildInstallmentReminderMessage(payload)
  assert.match(text, /• INS-0003 - شيول - بنك - القسط 4: سند 545456564 - 1,000 ريال/)
})

test('the screens: the items in the form and on the page, the name dialog', () => {
  const form = read('src', 'screens', 'installments', 'InstallmentContractFormScreen.tsx')
  assert.match(form, /<InstallmentContractItems/)
  assert.match(form, /items: itemsPayload\(values\.items\)/)
  const data = read('src', 'lib', 'installmentsData.ts')
  assert.match(data, /p_items: input\.items,/)
  assert.match(data, /supabase\.rpc\('set_installment_row_note', \{\n      p_schedule_id: scheduleId,\n      p_note: name\.trim\(\) \|\| null,/)
  assert.match(data, /is_partial,state,days_until_due,kind,title,note'/)
  const page = read('src', 'screens', 'installments', 'InstallmentContractDetail.tsx')
  assert.match(page, /key: 'items'/)
  assert.match(page, /open\(\{ kind: 'row_name', row \}\)/)
  assert.match(page, /canManage && !cancelled \? \(\n\s*<Button/)
  const dialogs = read('src', 'components', 'installments', 'InstallmentDateDialogs.tsx')
  assert.match(dialogs, /export function SetInstallmentNameDialog/)
  // The copy of both languages, no alif with hamza or madda in the Arabic.
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'instItemsTitle',
    'instItemName',
    'instItemQuantity',
    'instItemAdd',
    'instItemRemove',
    'instItemNamePlaceholder',
    'instItemErrName',
    'instItemErrQuantity',
    'instItemsCheckRows',
    'instErrItems',
    'instRowName',
    'instRowNameAction',
    'instRowNameTitle',
    'instRowNamePlaceholder',
    'instRowNameHint',
    'instRowNameErr',
    'instRowNameSaved',
    'instCalcVatLine',
  ]) {
    const found = [...translations.matchAll(new RegExp(`\\n    ${key}: '([^']*)'`, 'g'))]
    assert.equal(found.length, 2, key)
    assert.doesNotMatch(found[0][1], /[أإآ]/, key)
  }
})
