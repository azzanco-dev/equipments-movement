const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-11-22: «اعتمد تصميم الجهات التمويلية وابني» (the Figma frames
// 94:7491 / 94:7982 / 94:8228), and on the calendar «شيل "بعده" … يكفي انك
// تعرض حق اليوم الي اخترته, وتحسب الاجمالي حق اليوم».

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const plain = (value) => JSON.parse(JSON.stringify(value))

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
const loadTs = (file) => loadLibModule(path.basename(file, '.ts'))

test('the four figures over the financier cards', () => {
  const board = loadTs('src/lib/installmentsBoard.ts')
  const figures = new Map([
    ['a', { activeContracts: 3, remaining: 600 }],
    ['b', { activeContracts: 0, remaining: 0 }],
    ['c', { activeContracts: 1, remaining: 400.5 }],
  ])
  const overview = board.financiersOverview(
    [
      { id: 'a', iban: 'SA0380000000608010167519' },
      { id: 'b', iban: null },
      { id: 'c' },
      { id: 'd', iban: '' },
    ],
    figures,
  )
  assert.deepEqual(plain(overview), {
    financiers: 4,
    withActive: 2,
    activeContracts: 4,
    remaining: 1000.5,
    top: { financierId: 'a', share: 60 },
    withoutIban: 3,
  })
  assert.equal(board.financiersOverview([], new Map()).top, null)
  assert.equal(board.remainingShare(250, 1000), 25)
  assert.equal(board.remainingShare(5, 0), 0)
})

test('a calendar day totals its installments, paid or not', () => {
  const board = loadTs('src/lib/installmentsBoard.ts')
  assert.equal(
    board.dayDueTotal([{ amount: 0.1 }, { amount: '0.2' }, { amount: 7083.33 }]),
    7083.63,
  )
  assert.equal(board.dayDueTotal([]), 0)
  const calendar = read('src', 'components', 'installments', 'InstallmentsCalendarTab.tsx')
  assert.match(calendar, /dayDueTotal\(dayRows\)/)
  assert.match(calendar, /t\('instCalDayTotal'\)/)
  assert.doesNotMatch(calendar, /instCalAfter|const after/)
  assert.doesNotMatch(read('src', 'i18n', 'translations.ts'), /instCalAfter/)
})

test('the active-contracts words', () => {
  const view = loadTs('src/lib/installmentsView.ts')
  assert.equal(view.activeCountWords(1, 'ar'), 'عقد نشط واحد')
  assert.equal(view.activeCountWords(2, 'ar'), 'عقدين نشطين')
  assert.equal(view.activeCountWords(5, 'ar'), '5 عقود نشطة')
  assert.equal(view.activeCountWords(12, 'ar'), '12 عقد نشط')
  assert.equal(view.activeCountWords(0, 'ar'), 'لا توجد عقود نشطة')
  assert.equal(view.activeCountWords(1, 'en'), '1 active contract')
})

test('the financiers tab is cards with the payment account', () => {
  const tab = read('src', 'components', 'installments', 'InstallmentsFinanciersTab.tsx')
  assert.doesNotMatch(tab, /<DataTable/)
  for (const piece of [
    '<FigureCard',
    'financiersOverview(',
    'financierTone(financiers, financier.id)',
    "<BankAccountLine account={account} showSource={false} />",
    "t('instNoAccount')",
    "t('instFinAddAccount')",
    "t('instFinContractsLink')",
    "t('instCardNextDue')",
    "t('instFinAddTileDesc')",
    'border-dashed',
  ])
    assert.ok(tab.includes(piece), piece)
  // «عقود الجهة» opens the contracts tab searched by the financier's name.
  const screen = read('src', 'screens', 'installments', 'InstallmentsScreen.tsx')
  assert.match(
    screen,
    /onOpenContracts=\{\(financier\) =>\s*update\(\{\s*\[INSTALLMENTS_URL_KEYS\.tab\]: 'contracts',\s*\[INSTALLMENTS_URL_KEYS\.contractChip\]: null,\s*\[INSTALLMENTS_URL_KEYS\.contractSearch\]: financier\.name,/,
  )
  // The next due date comes with the bounded summary read.
  assert.match(
    read('src', 'lib', 'installmentsData.ts'),
    /\.select\('financier_id,status,remaining_total,next_due_date'\)/,
  )
  // The financier dialog puts the IBAN on its own row.
  assert.match(
    read('src', 'components', 'installments', 'InstallmentFinancierDialog.tsx'),
    /ibanHint=\{t\('instFinancierIbanHint'\)\}\s*stacked/,
  )
})

test('the new copy exists in both languages, without hamza in Arabic', () => {
  const source = read('src', 'i18n', 'translations.ts')
  const keys = [
    'instFinWithActive',
    'instFinAtFinanciers',
    'instFinTopShare',
    'instFinNoIbanTitle',
    'instFinNoIbanHint',
    'instFinNoIbanNone',
    'instFinNoContracts',
    'instFinAddAccount',
    'instFinContractsLink',
    'instFinCanDelete',
    'instFinAddTileDesc',
    'instCalDayTotal',
  ]
  for (const key of keys) {
    const lines = source.split('\n').filter((line) => line.trim().startsWith(key + ':'))
    assert.equal(lines.length, 2, key)
    assert.doesNotMatch(lines[0], /[أإآ]/, key)
  }
})
