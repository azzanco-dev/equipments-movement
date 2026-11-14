const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Migration 0193 (screens): a PO cannot be created empty, a draft PO can be
// deleted, a movement on a PO is locked, the card pricing unit rule, and the
// stale texts of the closed / period model are gone.

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

function translationBlocks() {
  const source = read('src', 'i18n', 'translations.ts')
  const second = source.indexOf('\n  en: {')
  assert.ok(second > 0)
  return [source.slice(0, second), source.slice(second)]
}

// --- Task 1: no empty PO ------------------------------------------------------

test('create dialog: the button follows the lines that are sent', () => {
  const dialog = read('src', 'components', 'purchasing', 'CreateSupplierPoDialog.tsx')
  assert.match(dialog, /const sendLines = useMemo\(/)
  assert.match(dialog, /const sendCount = sendLines\.length/)
  assert.match(dialog, /disabled=\{visitsState !== 'ready' \|\| sendCount === 0\}/)
  assert.match(dialog, /\{sendCount > 0 \? ` \(\$\{sendCount\}\)` : ''\}/)
  assert.doesNotMatch(dialog, /\(\$\{pickedCount\}\)/)
  assert.match(dialog, /const lines: SupplierPoCreateLine\[\] = sendLines/)
  assert.match(dialog, /visitsState !== 'ready' \|\| sendCount === 0\) return/)
})

test('create dialog: a failed units load is an error with a retry', () => {
  const dialog = read('src', 'components', 'purchasing', 'CreateSupplierPoDialog.tsx')
  assert.match(dialog, /visitsRetry/)
  assert.match(dialog, /onRetry=\{\(\) => setVisitsRetry/)
  assert.match(dialog, /\[open, partyKey, visitsRetry\]/)
  assert.match(dialog, /supplierPoUnitsLoadError/)
})

test('create dialog: po_has_no_lines and the equipment tokens are mapped', () => {
  const dialog = read('src', 'components', 'purchasing', 'CreateSupplierPoDialog.tsx')
  assert.match(dialog, /includes\('po_has_no_lines'\)/)
  assert.match(dialog, /supplierPoErrorPickOneUnit/)
  const { supplierPoFormMessage } = loadLibModule('purchasing')
  const msg = (token) => supplierPoFormMessage({ message: token })
  assert.equal(msg('equipment_not_at_po_project'), 'supplierPoErrorNotAtProject')
  assert.equal(msg('equipment_not_of_po_supplier'), 'supplierPoErrorNotOfSupplier')
  assert.equal(msg('invalid_equipment'), 'supplierPoErrorInvalidEquipment')
  assert.equal(msg('po_number_issued'), 'supplierPoErrorNumberIssued')
  assert.equal(msg('po_approved_locked'), 'supplierPoErrorApprovedLocked')
  const [ar] = translationBlocks()
  assert.match(ar, /supplierPoErrorPickOneUnit: 'اختر معدة واحدة على الاقل\.'/)
})

// --- Task 2: delete a draft PO -------------------------------------------------

test('purchasingData wraps delete_supplier_po like the other writes', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(data, /export async function deleteSupplierPo\(/)
  assert.match(data, /supabase\.rpc\('delete_supplier_po', \{ p_po_id: poId \}\)/)
  assert.match(data, /asResult<DeletedSupplierPo>/)
})

test('PO page: delete only for a manager on a draft reference, in the menu on every size', () => {
  const page = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  assert.match(
    page,
    /onDelete=\{\s+canManage &&\s+!approved &&\s+isSupplierPoDraftRef\(po\.po_number\)/,
  )
  // A manager's only menu on a phone is the bar's: it carries the item too.
  assert.match(page, /optionsMenu\(editable \? 'h-11' : 'h-11 flex-1'\)/)
  assert.doesNotMatch(page, /withDelete/)
  assert.match(page, /<DeleteSupplierPoDialog/)
  assert.match(page, /onStale=\{fetchData\}/)
  const menu = read('src', 'components', 'purchasing', 'SupplierPoOptionsMenu.tsx')
  assert.match(menu, /tone="danger"/)
  assert.match(menu, /supplierPoDelete/)
  const app = read('src', 'App.tsx')
  assert.match(app, /onDeleted=\{\(\) => router\.replace\('\/purchasing\/orders'\)\}/)
})

test('delete dialog: destructive confirm, locked while saving, stale refetch', () => {
  const dialog = read('src', 'components', 'purchasing', 'DeleteSupplierPoDialog.tsx')
  assert.match(dialog, /variant="danger"/)
  assert.match(dialog, /if \(!next && saving\) return/)
  assert.match(dialog, /<bdi dir="ltr">\{po\.po_number\}<\/bdi>/)
  assert.match(dialog, /po_approved_locked/)
  assert.match(dialog, /po_number_issued/)
  assert.match(dialog, /invalid_po/)
  assert.match(dialog, /supplierPoFormMessage\(result\.error\)/)
  assert.doesNotMatch(dialog, /Input|Textarea/)
})

// --- Task 3: the movement lock -------------------------------------------------

test('movement_on_po maps to a code and its PO numbers are validated', () => {
  const errors = loadLibModule('movementErrors')
  assert.equal(
    errors.movementAdminErrorCode('movement_on_po: x', 'delete'),
    'movement_on_po',
  )
  assert.equal(errors.movementAdminErrorStatus('movement_on_po'), 409)
  assert.deepEqual(
    Array.from(errors.movementOnPoNumbers('DRAFT-0558, PO-2026110012, DRAFT-0558')),
    ['DRAFT-0558', 'PO-2026110012'],
  )
  assert.deepEqual(
    Array.from(errors.movementOnPoNumbers('relation x violates <b>, DRAFT-1')),
    ['DRAFT-1'],
  )
  assert.deepEqual(Array.from(errors.movementOnPoNumbers(null)), [])
  assert.equal(errors.movementOnPoNumbers('A-1,B-2,C-3,D-4,E-5,F-6').length, 5)
})

test('the admin edit / delete message carries the numbers, LTR-isolated', () => {
  const admin = loadLibModule('movementAdmin')
  const [ar] = translationBlocks()
  const t = (key) => new RegExp(`${key}:\\s*'([^']*)'`).exec(ar)[1]
  assert.equal(admin.movementAdminErrorKey('movement_on_po', 'update'), 'movementEditOnPo')
  assert.equal(admin.movementAdminErrorKey('movement_on_po', 'delete'), 'movementDeleteOnPo')
  const edit = admin.movementAdminErrorText(t, 'movement_on_po', 'update', ['DRAFT-0558'])
  assert.match(edit, /هذه الدخولية عليها امر شراء \(⁦DRAFT-0558⁩\)/)
  assert.match(edit, /ثم عدل الحركة\.$/)
  const del = admin.movementAdminErrorText(t, 'movement_on_po', 'delete', [
    'DRAFT-0558',
    'PO-2026110012',
    '<script>',
  ])
  assert.match(del, /⁦DRAFT-0558⁩، ⁦PO-2026110012⁩/)
  assert.doesNotMatch(del, /script/)
  const none = admin.movementAdminErrorText(t, 'movement_on_po', 'delete', [])
  assert.doesNotMatch(none, /\{numbers\}|\(\)/)
  assert.match(none, /عليها امر شراء\./)
})

test('the API route and both screens pass the numbers along', () => {
  const route = read('app', 'api', 'movements', '[id]', 'route.ts')
  assert.equal(route.match(/movementOnPoNumbers\(error\.details\)/g).length, 2)
  assert.match(
    read('src', 'screens', 'MovementDetail.tsx'),
    /movementAdminErrorText\(t, result\?\.error, 'delete', result\?\.po_numbers\)/,
  )
  assert.match(
    read('src', 'components', 'movement', 'MovementEditDialog.tsx'),
    /result\?\.po_numbers/,
  )
})

// --- Task 4: the pricing unit rule ---------------------------------------------

test('cardPricingApprovalBlocker refuses different units, accepts the same', () => {
  const { cardPricingApprovalBlocker, cardPricingFormMessage } = loadLibModule('sales')
  const base = {
    pricing_status: 'draft',
    card_client_price: 1000,
    supplier_line_id: 'l1',
    supplier_price: 800,
    card_client_price_unit: 'month',
    supplier_rate_unit: 'month',
  }
  assert.equal(cardPricingApprovalBlocker(base), null)
  assert.equal(
    cardPricingApprovalBlocker({ ...base, supplier_rate_unit: 'day' }),
    'cardPricingBlockedUnitMismatch',
  )
  assert.equal(
    cardPricingApprovalBlocker({
      ...base,
      card_client_price_unit: 'day',
      supplier_rate_unit: 'day',
    }),
    null,
  )
  assert.equal(
    cardPricingApprovalBlocker({ ...base, supplier_rate_unit: 'day', unsaved: true }),
    'cardPricingBlockedUnsaved',
  )
  assert.equal(
    cardPricingFormMessage({ message: 'card_pricing_unit_mismatch' }),
    'cardPricingBlockedUnitMismatch',
  )
  const [ar] = translationBlocks()
  assert.match(
    ar,
    /cardPricingBlockedUnitMismatch: 'وحدة سعر العميل تختلف عن وحدة سعر المورد'/,
  )
})

test('the approve confirmation says the PO is approved only conditionally', () => {
  const [ar] = translationBlocks()
  assert.match(
    ar,
    /اذا اعتمدت اسعار كل معدات الـ PO وكانت كلها مسعرة، يعتمد PO المورد تلقائيا ويصدر له رقم\./,
  )
  const dialogs = read('src', 'components', 'sales', 'CardPricingDialogs.tsx')
  assert.doesNotMatch(dialogs, /cardPricingApproveConfirmDesc'\)\.replace/)
})

// --- Task 5: stale texts ------------------------------------------------------

test('stale open / period texts are rewritten', () => {
  const [ar, en] = translationBlocks()
  assert.match(ar, /cardPricingBlockedNoSupplierLine: 'المعدة ليست على PO مورد\.'/)
  assert.match(ar, /cardMonthErrorOutsideCard: 'الشهر خارج زيارة المعدة للمشروع\.'/)
  assert.doesNotMatch(ar, /PO مورد مفتوح|فترة الكرت/)
  assert.doesNotMatch(en, /open supplier PO|card's period/)
  assert.match(
    ar,
    /supplierPoApprovedLockedNoticeNoApprove: 'هذا الامر معتمد ومقفل\. لتعديله يرجعه صاحب صلاحية الاعتماد للتعديل اولا\.'/,
  )
  const page = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  assert.match(
    page,
    /canApprove\s+\? 'supplierPoApprovedLockedNotice'\s+: 'supplierPoApprovedLockedNoticeNoApprove'/,
  )
})

test('the removed-feature keys are gone from both languages', () => {
  const removed = [
    'supplierPoCloseTypeNumber',
    'supplierPoErrorAlreadyOnOpenPo',
    'supplierPoErrorClosed',
    'siteUnitsAddTo',
    'equipmentCardEnd',
    'equipmentCardEndDesc',
    'equipmentCardReopen',
    'equipmentCardReopenOverlap',
    'equipmentCardsAwaitingEnd',
    'equipmentCardsAwaitingSwitch',
    'equipmentCardsAll',
    'adminAttentionAwaitingEnd',
  ]
  const [ar, en] = translationBlocks()
  for (const key of removed) {
    assert.doesNotMatch(ar, new RegExp(`^    ${key}:`, 'm'), key)
    assert.doesNotMatch(en, new RegExp(`^    ${key}:`, 'm'), key)
  }
  // The client PO keeps its closing keys.
  assert.match(ar, /^    supplierPoCloseTypeNumberHint:/m)
  assert.match(ar, /^    supplierPoClosedAt:/m)
})

// Owner 2026-11-14 («هل تقدر تظهر لي تاريخ الدخول في كل سطر معدة؟», on the PO
// page): every line card shows its unit's own entry day.
test('PO page: every line shows its unit entry date', () => {
  const data = read('src', 'lib', 'purchasingData.ts')
  assert.match(
    data,
    /card:equipment_cards\(id,equipment_id,entry_log_id,entry:entry_exit_logs\(recorded_at\),equipment:/,
  )
  const page = read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx')
  assert.match(page, /const entryAt = line\.card\?\.entry\?\.recorded_at \?\? null/)
  assert.match(page, /\{entryAt && \(/)
  assert.match(page, /\{t\('entryDate'\)\}/)
  // The Saudi day of the movement, not the browser's.
  assert.match(page, /formatDate\(saudiDateKey\(entryAt\)\)/)
})
