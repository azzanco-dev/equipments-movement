const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-11-11: the supplier PO number is issued at the first approval
// (a draft reference `DRAFT-0558` until then); the client's number is optional.

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

function loadLibModule(name, cache = new Map()) {
  if (cache.has(name)) return cache.get(name)
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
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
      parseInt,
      require(request) {
        const match = /^@\/lib\/(.+)$/.exec(request)
        if (match) return loadLibModule(match[1], cache)
        if (request === 'zod') return require('zod')
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

test('isSupplierPoDraftRef recognises the draft reference only', () => {
  const { isSupplierPoDraftRef } = loadLibModule('purchasing')
  assert.equal(isSupplierPoDraftRef('DRAFT-0558'), true)
  assert.equal(isSupplierPoDraftRef('DRAFT-12345'), true)
  for (const value of ['PO-2026110001', 'DRAFT-12', '', null, undefined]) {
    assert.equal(isSupplierPoDraftRef(value), false)
  }
})

test('the print sheet omits the PO number fact for a draft reference', () => {
  const src = read(
    'src',
    'components',
    'purchasing',
    'SupplierPoPrintSheet.tsx',
  )
  assert.match(src, /isSupplierPoDraftRef\(po\.po_number\)/)
  const block = src.slice(src.indexOf('const headerFacts'))
  const draftIdx = block.indexOf('isSupplierPoDraftRef')
  const numberIdx = block.indexOf("'supplierPoPrintNumber'")
  assert.ok(draftIdx > -1 && numberIdx > draftIdx)
  assert.match(src, /supplierPoPrintIssueDate/)
  assert.match(src, /supplierPoPrintStatus/)
})

test('the approved event detail shows the number issued', () => {
  const src = read('src', 'lib', 'purchasingData.ts')
  assert.match(
    src,
    /case 'approved':\s*return typeof payload\.po_number === 'string' && payload\.po_number\s*\? payload\.po_number\s*: null/,
  )
})

test('the PO page shows the number-at-approval notice for a draft reference', () => {
  const src = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  assert.match(
    src,
    /isSupplierPoDraftRef\(po\.po_number\) && \(\s*<Notice tone="info" size="compact">\s*\{t\('supplierPoNumberAtApprovalNotice'\)\}/,
  )
})

test('the client schema accepts a blank number and caps it at 60', () => {
  const v = loadLibModule('formValidation')
  const base = {
    company_id: 'c1',
    project_id: 'p1',
    po_number: '',
    issue_date: '2026-10-01',
    expiry_date: '',
    standard_hours: '260',
    notes: '',
  }
  assert.equal(v.clientPoFormSchema.safeParse(base).success, true)
  assert.equal(
    v.clientPoFormSchema.safeParse({ ...base, po_number: '   ' }).success,
    true,
  )
  const bad = v.clientPoFormSchema.safeParse({
    ...base,
    po_number: 'x'.repeat(61),
  })
  assert.equal(bad.success, false)
  assert.equal(bad.error.issues[0].message, 'clientPoNumberInvalid')
})

test('create_client_po sends null for a blank number', () => {
  const src = read('src', 'lib', 'salesData.ts')
  assert.match(src, /p_po_number: values\.po_number\.trim\(\) \|\| null/)
  const dialog = read('src', 'components', 'sales', 'CreateClientPoDialog.tsx')
  assert.match(dialog, /clientPoNumberOptionalHint/)
})

test('the new keys exist once per language and the Arabic has no hamza alif', () => {
  const src = read('src', 'i18n', 'translations.ts')
  for (const key of [
    'supplierPoNumberAtApprovalNotice',
    'clientPoNumberOptionalHint',
  ]) {
    const hits = src.match(new RegExp(`^    ${key}:`, 'gm')) || []
    assert.equal(hits.length, 2, key)
  }
  assert.equal((src.match(/po-number-at-approval — start/g) || []).length, 2)
  const arBlock = src
    .split('// po-number-at-approval — start')[1]
    .split('// po-number-at-approval — end')[0]
  assert.doesNotMatch(arBlock, /[أإآ]/)
  const confirm = /supplierPoApproveConfirmDesc:\s*'([^']*)'/.exec(src)[1]
  assert.doesNotMatch(confirm, /[أإآ]/)
  assert.match(confirm, /يصدر رقم/)
})

// Owner 2026-11-11 («غير لون بادج الدرافت … البادج الي عبارة عن DRAFT-0565»):
// the pill of a draft reference is grey, an issued number stays green.
test('a draft reference pill is grey on every screen that draws the PO pill', () => {
  const pill = read('src/components/sales/PoPill.tsx')
  assert.match(pill, /import \{ isSupplierPoDraftRef \} from '@\/lib\/purchasing'/)
  const draft = pill
    .split('const DRAFT_PILL_STYLE: CSSProperties = {')[1]
    .split('}')[0]
  assert.match(draft, /color: 'var\(--fg\)'/)
  assert.match(draft, /backgroundColor: 'var\(--surface-hover\)'/)
  assert.match(
    pill,
    /return isSupplierPoDraftRef\(number\) \? DRAFT_PILL_STYLE : PO_PILL_STYLE/,
  )
  // The other side's PO stays muted whatever its number.
  assert.match(pill, /muted \? MUTED_PILL_STYLE : poPillStyle\(number\)/)
  for (const screen of ['PoUnitsList.tsx', 'SiteUnitsScreen.tsx']) {
    const src = read('src', 'screens', 'purchasing', screen)
    assert.match(src, /style=\{poPillStyle\(row\.po_number\)\}/, screen)
    assert.doesNotMatch(src, /SPO_(PILL|BUTTON)_STYLE/, screen)
  }
})
