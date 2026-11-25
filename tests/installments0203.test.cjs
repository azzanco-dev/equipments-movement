const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Migration 0203: installments («الاقساط»). Owner 2026-11-18: a section of
// this program in its simplest shape — a contract with one total amount, a
// down payment and a final payment, a generated schedule, free payments
// allocated to the oldest unpaid rows, and an OPTIONAL link to units.
//
// Source checks only: row level security on every table, no client write
// path but the financiers list, definer functions with the fixed
// search_path and the right grants, and the tokens the client maps being
// exactly the ones the SQL raises.

const ROOT = path.join(__dirname, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const FILE = '20261118100000_0203_installments.sql'
const SQL = fs
  .readFileSync(path.join(MIGRATIONS, FILE), 'utf8')
  .replace(/\r\n/g, '\n')
const CODE = SQL.replace(/--[^\n]*/g, '')
const FLAT = CODE.replace(/\s+/g, ' ')

function load(name) {
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const exports = {}
  vm.runInContext(
    `(function (exports, require) {${output}\n})`,
    vm.createContext({}),
    { filename: file },
  )(exports, (requested) => {
    throw new Error(`Unexpected module: ${requested}`)
  })
  return exports
}

const lib = load('installments')

const FUNCTION_WRITTEN_TABLES = [
  'installment_contracts',
  'installment_contract_equipment',
  'installment_schedule',
  'installment_payments',
  'installment_payment_allocations',
]
const TABLES = [
  'installment_financiers',
  'installment_contract_sequence',
  ...FUNCTION_WRITTEN_TABLES,
]

// name -> [argument types as written in REVOKE / GRANT, callable by clients]
const DEFINER_FUNCTIONS = {
  assert_installments_manage: ['', false],
  normalise_installment_financier: ['', false],
  next_installment_contract_number: ['', false],
  generate_installment_schedule: ['uuid', false],
  touch_installment_contract_from_child: ['', false],
  save_installment_contract: [
    'uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid[]',
    true,
  ],
  cancel_installment_contract: ['uuid, text', true],
  record_installment_payment: ['uuid, date, numeric, text, text, text', true],
  void_installment_payment: ['uuid, text', true],
}

function functionSource(name) {
  const start = CODE.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  assert.notEqual(start, -1, `function ${name} is missing`)
  const end = CODE.indexOf('$$;', start)
  assert.notEqual(end, -1)
  return CODE.slice(start, end)
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('0203 comes right after 0202 and carries no hamza alif', () => {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const at = files.indexOf(FILE)
  assert.ok(at > 0)
  assert.equal(
    files[at - 1],
    '20261117140000_0202_quotation_number_three_digits.sql',
  )
  assert.doesNotMatch(SQL, /[أإآ]/)
})

test('the two keys are database-enforced and held by the admin role only', () => {
  assert.match(
    FLAT,
    /'installments\.view', 'installments',[^)]*false, NULL, '\{\}', false, 'database', 1200\)/,
  )
  assert.match(
    FLAT,
    /'installments\.manage', 'installments',[^)]*false, NULL, ARRAY\['installments\.view'\], false, 'database', 1210\)/,
  )
  const grants = FLAT.match(/INSERT INTO public\.role_permissions[^;]*;/g)
  assert.equal(grants.length, 1)
  assert.match(grants[0], /\('admin', 'installments\.view', NULL\)/)
  assert.match(grants[0], /\('admin', 'installments\.manage', NULL\)/)
  assert.equal(grants[0].match(/\('/g).length, 2)
  // No role name decides anything, and the retired legacy mapping is not
  // brought back (the side repo's inst_0001 re-created it).
  assert.doesNotMatch(CODE, /is_admin\(|legacy_role_permissions|profiles\.role/)
})

test('every table has row level security and a read policy on installments.view', () => {
  for (const table of TABLES) {
    assert.match(
      FLAT,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`),
      table,
    )
  }
  for (const table of TABLES.filter(
    (name) => name !== 'installment_contract_sequence',
  )) {
    assert.match(
      FLAT,
      new RegExp(
        `CREATE POLICY select_${table} ON public\\.${table} FOR SELECT TO authenticated USING \\(\\(SELECT public\\.has_permission\\('installments\\.view'\\)\\)\\)`,
      ),
      table,
    )
  }
  // The counter is never reachable by a client.
  assert.doesNotMatch(
    FLAT,
    /POLICY \w+ ON public\.installment_contract_sequence/,
  )
  assert.match(
    FLAT,
    /REVOKE ALL ON TABLE public\.installment_contract_sequence FROM PUBLIC, anon, authenticated;/,
  )
})

test('only the financiers list is written directly, on installments.manage', () => {
  const writes = [
    ...FLAT.matchAll(
      /CREATE POLICY (\w+) ON public\.(\w+) FOR (INSERT|UPDATE|DELETE) TO authenticated ([^;]*);/g,
    ),
  ]
  assert.deepEqual(writes.map((match) => `${match[3]} ${match[2]}`).sort(), [
    'DELETE installment_financiers',
    'INSERT installment_financiers',
    'UPDATE installment_financiers',
  ])
  for (const match of writes) {
    assert.match(match[4], /has_permission\('installments\.manage'\)/)
    assert.doesNotMatch(match[4], /true\)|USING \(true/)
  }
  assert.match(
    FLAT,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.installment_financiers TO authenticated;/,
  )
  // The function-written tables are SELECT-only for clients.
  const grant = FLAT.match(/GRANT SELECT ON TABLE ([^;]*) TO authenticated;/)
  assert.ok(grant)
  for (const table of FUNCTION_WRITTEN_TABLES)
    assert.match(grant[1], new RegExp(`public\\.${table}\\b`), table)
  assert.doesNotMatch(
    grant[1],
    /installment_financiers|installment_contract_sequence/,
  )
})

test('definer functions pin the search_path and are granted as intended', () => {
  for (const [name, [args, callable]] of Object.entries(DEFINER_FUNCTIONS)) {
    const source = functionSource(name)
    assert.match(source, /SECURITY DEFINER/, name)
    assert.match(source, /SET search_path = public, pg_temp/, name)
    const signature = `public\\.${name}\\(\\s*${escape(args).replace(/, /g, ',\\s*')}\\s*\\)`
    if (callable) {
      assert.match(
        CODE,
        new RegExp(`REVOKE ALL ON FUNCTION ${signature}\\s*FROM PUBLIC, anon;`),
        name,
      )
      assert.match(
        CODE,
        new RegExp(
          `GRANT EXECUTE ON FUNCTION ${signature}\\s*TO authenticated;`,
        ),
        name,
      )
    } else {
      assert.match(
        CODE,
        new RegExp(
          `REVOKE ALL ON FUNCTION ${signature}\\s*FROM PUBLIC, anon, authenticated;`,
        ),
        name,
      )
      assert.doesNotMatch(
        CODE,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`),
        name,
      )
    }
  }
  // Every definer function of the file is in the table above.
  const defined = [
    ...CODE.matchAll(
      /CREATE OR REPLACE FUNCTION public\.(\w+)\([^$]*?SECURITY DEFINER/g,
    ),
  ].map((match) => match[1])
  assert.deepEqual(defined.sort(), Object.keys(DEFINER_FUNCTIONS).sort())
})

test('every writer checks installments.manage first', () => {
  for (const name of [
    'save_installment_contract',
    'cancel_installment_contract',
    'record_installment_payment',
    'void_installment_payment',
  ]) {
    const body = functionSource(name).split('BEGIN').slice(1).join('BEGIN')
    assert.match(
      body.trimStart(),
      /^PERFORM public\.assert_installments_manage\(\);/,
      name,
    )
  }
  assert.match(
    functionSource('assert_installments_manage'),
    /auth\.uid\(\) IS NULL OR NOT public\.has_permission\('installments\.manage'\)/,
  )
})

test('the client maps exactly the tokens the SQL raises', () => {
  const raised = new Set(
    [...CODE.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((match) => match[1]),
  )
  // The counter row is seeded by the migration: not a user-facing refusal.
  raised.delete('installment_contract_sequence_missing')
  // 0207 adds the delete of a cancelled contract and its one new token.
  const later = fs.readFileSync(
    path.join(MIGRATIONS, '20261121100000_0207_installment_delete_and_paid_on.sql'),
    'utf8',
  )
  for (const match of later.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g))
    raised.add(match[1])
  // 0208 adds the three account tokens.
  const accounts = fs.readFileSync(
    path.join(MIGRATIONS, '20261121120000_0208_installment_accounts.sql'),
    'utf8',
  )
  for (const match of accounts.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g))
    raised.add(match[1])
  // 0209 adds the first payments, the VAT, the date writers and the files;
  // two of its helpers are handed their token.
  const plan = fs
    .readFileSync(
      path.join(MIGRATIONS, '20261122100000_0209_installment_first_payments_vat_files.sql'),
      'utf8',
    )
    .replace(/--[^\n]*/g, '')
  for (const pattern of [
    /RAISE EXCEPTION '([a-z_]+)'/g,
    /installment_json_day\([^;]*?'(invalid_[a-z_]+)'\)/g,
  ])
    for (const match of plan.matchAll(pattern))
      // The migration's own guards are sentences, never tokens.
      if (lib.INSTALLMENT_ERROR_TOKENS.includes(match[1]) || match[1].startsWith('invalid_'))
        raised.add(match[1])
  // 0210 adds the items and the installment's name.
  const items = fs
    .readFileSync(
      path.join(MIGRATIONS, '20261123100000_0210_installment_items_and_names.sql'),
      'utf8',
    )
    .replace(/--[^\n]*/g, '')
  for (const match of items.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)) raised.add(match[1])
  // 0213 adds the payment edit and the installment's due day.
  const edits = fs
    .readFileSync(
      path.join(MIGRATIONS, '20261125100000_0213_installment_payment_and_due_date_edits.sql'),
      'utf8',
    )
    .replace(/--[^\n]*/g, '')
  for (const match of edits.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)) raised.add(match[1])
  assert.deepEqual([...raised].sort(), [...lib.INSTALLMENT_ERROR_TOKENS].sort())
})

test('the rules of the contract and its payments', () => {
  // The money terms are locked by a posted payment; a change rebuilds the
  // schedule.
  const save = functionSource('save_installment_contract')
  assert.match(save, /FOR UPDATE/)
  assert.match(
    save.replace(/\s+/g, ' '),
    /IF v_terms_changed AND EXISTS \( SELECT 1 FROM public\.installment_payments p WHERE p\.contract_id = c\.id AND p\.status = 'posted' \) THEN RAISE EXCEPTION 'contract_has_payments'/,
  )
  assert.match(
    save,
    /IF v_terms_changed THEN\s+PERFORM public\.generate_installment_schedule/,
  )
  // The link to units is optional and carries no rule on the unit.
  assert.match(save, /p_equipment_ids uuid\[\] DEFAULT NULL/)
  assert.doesNotMatch(CODE, /ownership_status|equipment_not_alazani/)

  // A payment is never dated ahead, never exceeds the balance, goes to the
  // oldest unpaid row first and closes the contract when it pays the rest.
  const record = functionSource('record_installment_payment')
  assert.match(record, /p_paid_on > public\.saudi_today\(\)/)
  assert.match(
    record,
    /IF v_amount > v_remaining THEN\s+RAISE EXCEPTION 'payment_exceeds_balance'/,
  )
  assert.match(record, /ORDER BY s\.due_date, s\.seq\s+FOR UPDATE/)
  assert.match(
    record,
    /IF v_amount = v_remaining THEN\s+UPDATE public\.installment_contracts SET status = 'paid_off'/,
  )

  // A void keeps the row, takes the allocations back and reopens.
  const voidFn = functionSource('void_installment_payment')
  assert.doesNotMatch(voidFn, /DELETE FROM/)
  assert.match(voidFn, /SET paid_amount = s\.paid_amount - a\.amount/)
  assert.match(voidFn, /voided_by = auth\.uid\(\)/)
  assert.match(
    voidFn,
    /IF c\.status = 'paid_off' THEN\s+UPDATE public\.installment_contracts SET status = 'active', closed_at = NULL/,
  )

  // Cancelling needs a reason and no posted payment.
  const cancel = functionSource('cancel_installment_contract')
  assert.match(cancel, /RAISE EXCEPTION 'reason_required'/)
  assert.match(cancel, /RAISE EXCEPTION 'contract_has_payments'/)
})

test('the number never restarts and is not cut past four digits', () => {
  assert.match(
    CODE,
    /RETURN 'INS-' \|\| lpad\(v_seq::text, GREATEST\(4, char_length\(v_seq::text\)\), '0'\);/,
  )
  assert.match(CODE, /contract_number ~ '\^INS-\[0-9\]\{4,\}\$'/)
  assert.ok(lib.INSTALLMENT_CONTRACT_NUMBER_PATTERN.test('INS-0001'))
  assert.ok(lib.INSTALLMENT_CONTRACT_NUMBER_PATTERN.test('INS-10000'))
  assert.ok(!lib.INSTALLMENT_CONTRACT_NUMBER_PATTERN.test('INS260001'))
})

test('the read views run with the reader rights and are read-only', () => {
  const views = [
    'installment_dues',
    'installment_contract_summary',
    'installment_payment_list',
    'installment_overview',
  ]
  for (const view of views) {
    assert.match(
      FLAT,
      new RegExp(
        `CREATE VIEW public\\.${view} WITH \\(security_invoker = true\\) AS`,
      ),
      view,
    )
  }
  const grant = FLAT.match(
    /GRANT SELECT ON ((?:public\.installment_\w+,? ?)+)TO authenticated;/,
  )
  assert.ok(grant)
  for (const view of views)
    assert.match(grant[1], new RegExp(`public\\.${view}\\b`))
  // The nearest dues: the state and the days to the due date by Saudi days.
  assert.match(CODE, /s\.due_date - public\.saudi_today\(\) AS days_until_due/)
  assert.match(CODE, /SELECT \(now\(\) AT TIME ZONE 'Asia\/Riyadh'\)::date;/)
  // The overview counts the unpaid rows of the ACTIVE contracts only.
  assert.match(
    CODE,
    /WHERE c\.status = 'active' AND s\.paid_amount < s\.amount;/,
  )
})

test('editable tables carry updated_at with its trigger', () => {
  for (const table of [
    'installment_financiers',
    'installment_contracts',
    'installment_schedule',
    'installment_payments',
  ]) {
    assert.match(
      FLAT,
      new RegExp(
        `CREATE TRIGGER ${table}_updated_at BEFORE UPDATE ON public\\.${table} FOR EACH ROW EXECUTE FUNCTION public\\.update_updated_at\\(\\);`,
      ),
      table,
    )
  }
  // A change of the units or the payments moves the contract.
  assert.match(
    FLAT,
    /CREATE TRIGGER installment_contract_equipment_touch_contract AFTER INSERT OR UPDATE OR DELETE/,
  )
  assert.match(
    FLAT,
    /CREATE TRIGGER installment_payments_touch_contract AFTER INSERT OR UPDATE OR DELETE/,
  )
})

test('the limits of the module equal the CHECKs', () => {
  assert.match(CODE, /installment_count BETWEEN 1 AND 360/)
  assert.equal(lib.INSTALLMENT_COUNT_MAX, 360)
  assert.match(CODE, /frequency_months IN \(1, 2, 3, 6, 12\)/)
  assert.deepEqual([...lib.INSTALLMENT_FREQUENCIES], [1, 2, 3, 6, 12])
  assert.match(CODE, /char_length\(btrim\(description\)\) BETWEEN 1 AND 200/)
  assert.equal(lib.INSTALLMENT_DESCRIPTION_MAX, 200)
  assert.match(CODE, /char_length\(notes\) <= 1000/)
  assert.equal(lib.INSTALLMENT_NOTES_MAX, 1000)
  assert.match(CODE, /char_length\(reference\) <= 80/)
  assert.equal(lib.INSTALLMENT_PAYMENT_REFERENCE_MAX, 80)
  assert.match(CODE, /char_length\(note\) <= 500/)
  assert.equal(lib.INSTALLMENT_PAYMENT_NOTE_MAX, 500)
  assert.match(CODE, /char_length\(btrim\(name\)\) BETWEEN 1 AND 120/)
  assert.equal(lib.INSTALLMENT_FINANCIER_NAME_MAX, 120)
  assert.match(CODE, /method IN \('transfer', 'cheque', 'auto_debit', 'cash'\)/)
  assert.deepEqual(
    [...lib.INSTALLMENT_PAYMENT_METHODS],
    ['transfer', 'cheque', 'auto_debit', 'cash'],
  )
  assert.match(CODE, /p_due_date <= p_today \+ 30/)
  assert.equal(lib.DUE_SOON_DAYS, 30)
})
