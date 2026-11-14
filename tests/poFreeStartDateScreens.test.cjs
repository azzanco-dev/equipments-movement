const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-11-14 (migration 0194, screens): the PO's start date is free —
// pre-filled with the unit's entry day, editable in the create dialog and on a
// draft PO — while the units of one PO still enter on the same day.

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')

function loadLib(name, cache = new Map()) {
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
        if (match) return loadLib(match[1], cache)
        if (request === 'zod') return require('zod')
        throw new Error(`Unexpected module: ${request}`)
      },
    },
    { filename: file },
  )
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value))

test('create dialog: the start date is editable and not overwritten once touched', () => {
  const d = read('src', 'components', 'purchasing', 'CreateSupplierPoDialog.tsx')
  assert.doesNotMatch(d, /disabled=\{pickedDay !== null\}/)
  assert.doesNotMatch(d, /supplierPoStartDateFollowsEntry/)
  assert.match(d, /hint=\{t\('supplierPoStartDateHint'\)\}/)
  assert.match(d, /const startTouched = useRef\(false\)/)
  assert.match(d, /if \(!pickedDay \|\| startTouched\.current\) return/)
  // Touched by the date control only; cleared on open and on a reset of the
  // party, company and project.
  assert.match(d, /startTouched\.current = true\n\s+update\(\{ start_date: value \}\)/)
  assert.equal((d.match(/startTouched\.current = false/g) ?? []).length, 5)
  assert.match(d, /start_date: preset\.startDate/)
})

test('create dialog: the units list depends on the ticked entry day, never the date', () => {
  const d = read('src', 'components', 'purchasing', 'CreateSupplierPoDialog.tsx')
  const pickedDay = d.slice(d.indexOf('const pickedDay = useMemo('), d.indexOf('const sameDayUnits'))
  assert.match(pickedDay, /unitsAtProject\.find\(\(visit\) => isPicked\(picked, visit\)\)/)
  assert.doesNotMatch(pickedDay, /start_date/)
  const same = d.slice(d.indexOf('const sameDayUnits'), d.indexOf('const otherDayCount'))
  assert.doesNotMatch(same, /start_date/)
  assert.match(d, /\[unitsAtProject, pickedDay\]/)
})

test('create dialog: every line carries its visit entry id', () => {
  const d = read('src', 'components', 'purchasing', 'CreateSupplierPoDialog.tsx')
  assert.match(d, /entry_log_id: visit\.entry_id,/)
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(data, /const VISIT_SELECT =\s+'entry_id,equipment_id/)
  const lib = loadLib('purchasing')
  assert.deepEqual(
    plain(
      lib.supplierPoEquipmentPayload([
        { equipment_id: 'e1', entry_log_id: 'x1', price: '', note: '', rate_unit: 'month' },
      ]),
    ),
    [{ equipment_id: 'e1', entry_log_id: 'x1', price: null, note: null, rate_unit: 'month' }],
  )
})

test('add dialog: filters by the PO units entry day and sends the entry id', () => {
  const lib = loadLib('purchasing')
  assert.equal(lib.sharedEntryDay([]), null)
  assert.equal(lib.sharedEntryDay(['2026-11-01', '2026-11-01']), '2026-11-01')
  assert.equal(lib.sharedEntryDay(['2026-11-01', '2026-11-02']), null)
  assert.equal(lib.sharedEntryDay(['2026-11-01', null]), null)

  const add = read('src', 'components', 'purchasing', 'AddEquipmentDialog.tsx')
  assert.match(add, /unitsEntryDay\?: string \| null/)
  assert.match(add, /entryDay: unitsEntryDay \?\? undefined,/)
  assert.doesNotMatch(add, /po\.start_date/)
  assert.match(add, /entryLogId:\s+\(option as Partial<EquipmentVisitOption> \| null\)\?\.entryLogId \?\? null/)

  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(data, /entryLogId: visit\.entry_id,/)
  assert.match(data, /\.\.\.\(input\.entryLogId \? \{ p_entry_log_id: input\.entryLogId \} : \{\}\),/)

  const detail = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  assert.match(detail, /const unitsEntryDay = sharedEntryDay\(/)
  assert.match(detail, /unitsEntryDay=\{unitsEntryDay\}/)
})

test('edit dialog: a draft start date is free, an approved one stays locked', () => {
  const edit = read('src', 'components', 'purchasing', 'EditSupplierPoDialog.tsx')
  assert.match(edit, /disabled=\{approved\}/)
  assert.match(edit, /hint=\{approved \? t\('supplierPoStartDateApprovedHint'\) : undefined\}/)
  assert.doesNotMatch(edit, /hasLines|supplierPoStartDateLockedHint/)
  const detail = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  assert.match(detail, /<EditSupplierPoDialog\s+po=\{po\}\s+approved=\{approved\}/)
})

test('texts: the entry-day mismatch message, the removed old-rule copy', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const second = source.indexOf('\n  en: {')
  const [ar, en] = [source.slice(0, second), source.slice(second)]
  assert.match(
    ar,
    /supplierPoErrorEntryDateMismatch:\s+'المعدة دخلت المشروع في يوم غير يوم دخول معدات هذا الامر\.'/,
  )
  assert.match(ar, /supplierPoStartDateHint: 'يتعبا بتاريخ دخول المعدة، ويمكنك تغييره\.'/)
  assert.match(en, /supplierPoErrorEntryDateMismatch:/)
  for (const block of [ar, en])
    for (const key of [
      'supplierPoStartDateFollowsEntry',
      'supplierPoStartDateLockedHint',
      'supplierPoErrorStartDateLocked',
    ])
      assert.doesNotMatch(block, new RegExp(`^    ${key}:`, 'm'), key)
  // New Arabic copy: plain alif only.
  for (const key of ['supplierPoStartDateApprovedHint', 'supplierPoEquipmentSameDayHint']) {
    const match = new RegExp(`^    ${key}:\\s*\\n?\\s*'([^'\\n]*)',$`, 'm').exec(ar)
    assert.ok(match, key)
    assert.doesNotMatch(match[1], /[أإآ]/, key)
    assert.match(en, new RegExp(`^    ${key}:`, 'm'), key)
  }
  // The entry-day mismatch is a unit message, never a start-date field error.
  const lib = read('src', 'lib', 'purchasing.ts')
  assert.doesNotMatch(lib, /match: 'entry_date_mismatch',\s+field: 'start_date'/)
  assert.doesNotMatch(lib, /match: 'po_start_date_locked'/)
})
