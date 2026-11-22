const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// 0208 (owner 2026-11-21): the bank and the IBAN of a financier, and a
// contract's OWN account for a financier that sends another IBAN with each
// contract; the screens show the account a contract is paid to.

const ROOT = path.join(__dirname, '..')
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

const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')
const SQL = read('supabase', 'migrations', '20261121120000_0208_installment_accounts.sql')
const FLAT = SQL.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ')

test('0208: the account columns on the financier and the contract', () => {
  for (const table of ['installment_financiers', 'installment_contracts']) {
    assert.match(
      FLAT,
      new RegExp(
        `ALTER TABLE public\\.${table} ADD COLUMN bank_name text CONSTRAINT ${table}_bank_name_fkey REFERENCES public\\.banks\\(name\\) ON UPDATE CASCADE ON DELETE RESTRICT, ADD COLUMN iban text CONSTRAINT ${table}_iban_check CHECK \\(iban IS NULL OR iban ~ '\\^SA\\[0-9\\]\\{4\\}\\[0-9A-Z\\]\\{18\\}\\$'\\);`,
      ),
      table,
    )
  }
  // The financier's trigger normalises the account.
  assert.match(FLAT, /NEW\.bank_name := NULLIF\(btrim\(NEW\.bank_name\), ''\);/)
  assert.match(FLAT, /NEW\.iban := NULLIF\(upper\(regexp_replace\(NEW\.iban, '\[\\s-\]', '', 'g'\)\), ''\);/)
  // No uniqueness on an IBAN.
  assert.doesNotMatch(FLAT, /UNIQUE[^;]*iban/i)
})

test('0208: save_installment_contract takes p_account, the old one is dropped', () => {
  assert.match(
    FLAT,
    /DROP FUNCTION public\.save_installment_contract\( uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid\[\] \);/,
  )
  assert.match(FLAT, /p_equipment_ids uuid\[\] DEFAULT NULL, p_account jsonb DEFAULT NULL \) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp/)
  assert.match(FLAT, /RAISE EXCEPTION 'invalid_account' USING ERRCODE = '22023'/)
  assert.match(FLAT, /RAISE EXCEPTION 'invalid_bank' USING ERRCODE = '22023'/)
  assert.match(FLAT, /RAISE EXCEPTION 'invalid_iban' USING ERRCODE = '22023'/)
  // SQL NULL keeps the stored account.
  assert.match(FLAT, /bank_name = CASE WHEN v_account_set THEN v_bank ELSE c\.bank_name END/)
  assert.match(FLAT, /iban = CASE WHEN v_account_set THEN v_iban ELSE c\.iban END/)
  // The key is still checked first.
  const body = FLAT.slice(FLAT.indexOf('CREATE OR REPLACE FUNCTION public.save_installment_contract('))
  assert.ok(body.indexOf('assert_installments_manage()') < body.indexOf('p_account IS NOT NULL'))
  assert.match(FLAT, /GRANT EXECUTE ON FUNCTION public\.save_installment_contract\( uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid\[\], jsonb \) TO authenticated;/)
  assert.match(FLAT, /REVOKE ALL ON FUNCTION public\.save_installment_contract\( uuid, text, uuid, numeric, numeric, numeric, integer, integer, date, text, uuid\[\], jsonb \) FROM PUBLIC, anon;/)
})

test('0208: the contract summary appends both accounts', () => {
  assert.match(FLAT, /CREATE OR REPLACE VIEW public\.installment_contract_summary WITH \(security_invoker = true\)/)
  assert.match(
    FLAT,
    /AS equipment_count, f\.bank_name AS financier_bank_name, f\.iban AS financier_iban, c\.bank_name AS contract_bank_name, c\.iban AS contract_iban FROM public\.installment_contracts c/,
  )
})

test('the screens: the account of a contract, the financier dialog and the form', () => {
  const view = loadLibModule('installmentsView')
  const row = (values) => ({
    financier_bank_name: null,
    financier_iban: null,
    contract_bank_name: null,
    contract_iban: null,
    ...values,
  })
  assert.equal(view.installmentAccountOf(row({})), null)
  const plain = (value) => JSON.parse(JSON.stringify(value))
  assert.deepEqual(
    plain(view.installmentAccountOf(row({ financier_bank_name: 'B', financier_iban: 'SA1' }))),
    { bankName: 'B', iban: 'SA1', own: false },
  )
  // The contract's own account wins.
  assert.deepEqual(
    plain(
      view.installmentAccountOf(
        row({ financier_bank_name: 'B', financier_iban: 'SA1', contract_iban: 'SA2' }),
      ),
    ),
    { bankName: null, iban: 'SA2', own: true },
  )
  const data = read('src', 'lib', 'installmentsData.ts')
  assert.match(data, /INSTALLMENT_FINANCIER_SELECT = 'id,name,bank_name,iban'/)
  assert.match(data, /p_account: \{\s*bank_name: input\.bankName\.trim\(\) \|\| null,\s*iban: normalizeIban\(input\.iban\) \|\| null,\s*\}/)
  const dialog = read('src', 'components', 'installments', 'InstallmentFinancierDialog.tsx')
  assert.match(dialog, /<BankAccountFields/)
  // 0209: the contract's form is a page, its values in installmentPlan.ts.
  assert.match(
    read('src', 'lib', 'installmentPlan.ts'),
    /bank_name: contract\.contract_bank_name \?\? ''/,
  )
  const form = read('src', 'screens', 'installments', 'InstallmentContractFormScreen.tsx')
  assert.match(form, /<BankAccountFields/)
  const page = read('src', 'screens', 'installments', 'InstallmentContractDetail.tsx')
  assert.match(page, /<BankAccountLine account=\{installmentAccountOf\(contract\)\} \/>/)
  const pay = read('src', 'components', 'installments', 'InstallmentPaymentDialog.tsx')
  assert.match(pay, /<BankAccountLine account=\{installmentAccountOf\(ready\.contract\)\} \/>/)
  const translations = read('src', 'i18n', 'translations.ts')
  const blocks = [
    ...translations.matchAll(
      /\/\/ installment-accounts \(0208\)\n([\s\S]*?)\/\/ end installment-accounts \(0208\)/g,
    ),
  ]
  assert.equal(blocks.length, 2)
  assert.doesNotMatch(blocks[0][1], /[أإآ]/)
  const keysOf = (block) => [...block.matchAll(/^\s+([A-Za-z]+):/gm)].map((m) => m[1])
  assert.deepEqual(keysOf(blocks[0][1]), keysOf(blocks[1][1]))
})
