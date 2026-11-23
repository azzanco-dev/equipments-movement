const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// «الاقساط» (migration 0203), the real screens (owner 2026-11-18, «اعتمد
// وابني»): the hidden page /installments with its four tabs, the contract
// page /installments/:id, the dialogs, the data module on the four database
// functions, the navigation, the form rules and the copy.

const ROOT = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n')
const exists = (...parts) => fs.existsSync(path.join(ROOT, ...parts))

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
      URLSearchParams,
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

const plain = (value) => JSON.parse(JSON.stringify(value ?? null))

const MIGRATION = read(
  'supabase',
  'migrations',
  '20261118100000_0203_installments.sql',
)
// 0208 re-creates save_installment_contract (p_account) and adds the
// account columns.
const LATER = read(
  'supabase',
  'migrations',
  '20261121120000_0208_installment_accounts.sql',
)
const RECEIPTS_MIGRATION = read(
  'supabase',
  'migrations',
  '20261119140000_0206_installment_payment_receipts.sql',
)
// 0209 re-creates the save and the payment and appends columns.
const PLAN_MIGRATION = read(
  'supabase',
  'migrations',
  '20261122100000_0209_installment_first_payments_vat_files.sql',
)
// 0210 re-creates the save (p_items), adds the items and the name writer.
const ITEMS_MIGRATION = read(
  'supabase',
  'migrations',
  '20261123100000_0210_installment_items_and_names.sql',
)
const DATA = read('src', 'lib', 'installmentsData.ts')
const APP = read('src', 'App.tsx')

/** A source without its comments (they may say what is NOT there). */
const codeOf = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** The screens and their pieces (everything that renders). */
const UI_FILES = [
  ['src', 'screens', 'installments', 'InstallmentsScreen.tsx'],
  ['src', 'screens', 'installments', 'InstallmentContractDetail.tsx'],
  ['src', 'components', 'installments', 'cells.tsx'],
  ['src', 'components', 'installments', 'InstallmentsDashboardTab.tsx'],
  ['src', 'components', 'installments', 'InstallmentsContractsTab.tsx'],
  ['src', 'components', 'installments', 'InstallmentsDuesTab.tsx'],
  ['src', 'components', 'installments', 'InstallmentsFinanciersTab.tsx'],
  ['src', 'screens', 'installments', 'InstallmentContractFormScreen.tsx'],
  ['src', 'components', 'installments', 'InstallmentContractFiles.tsx'],
  ['src', 'components', 'installments', 'InstallmentDateDialogs.tsx'],
  ['src', 'components', 'installments', 'InstallmentFirstPayments.tsx'],
  ['src', 'components', 'installments', 'ContractPaymentTable.tsx'],
  ['src', 'components', 'installments', 'InstallmentPlanSummary.tsx'],
  ['src', 'components', 'installments', 'InstallmentVatRow.tsx'],
  ['src', 'components', 'installments', 'boardParts.tsx'],
  ['src', 'components', 'installments', 'InstallmentsCalendarTab.tsx'],
  ['src', 'components', 'installments', 'InstallmentPaymentDialog.tsx'],
  ['src', 'components', 'installments', 'InstallmentReasonDialogs.tsx'],
  ['src', 'components', 'installments', 'InstallmentFinancierDialog.tsx'],
  ['src', 'components', 'installments', 'useInstallmentsUrl.ts'],
  ['src', 'components', 'installments', 'useLoad.ts'],
  ['src', 'components', 'installments', 'flash.ts'],
]
const LIB_FILES = [
  ['src', 'lib', 'installmentsView.ts'],
  ['src', 'lib', 'installmentsData.ts'],
  ['src', 'lib', 'installmentPlan.ts'],
  ['src', 'lib', 'installmentFiles.ts'],
]
const NEW_FILES = [...UI_FILES, ...LIB_FILES]

/** The `// installments-screens` … `// end installments-screens` block of
 *  each language. */
function screenBlocks() {
  const source = read('src', 'i18n', 'translations.ts')
  const blocks = []
  let from = 0
  for (;;) {
    const start = source.indexOf('// installments-screens', from)
    if (start < 0) break
    const end = source.indexOf('// end installments-screens', start)
    assert.ok(end > start)
    blocks.push(source.slice(start, end))
    from = end + 1
  }
  return blocks
}

const keysOf = (block) =>
  [...block.matchAll(/^\s+([A-Za-z0-9_]+):/gm)].map((match) => match[1])

/** Every key of a language of translations.ts (`ar` first, then `en`). */
function languageKeys() {
  const source = read('src', 'i18n', 'translations.ts')
  const en = source.indexOf('\n  en: {')
  assert.ok(en > 0)
  return [
    new Set(keysOf(source.slice(0, en))),
    new Set(keysOf(source.slice(en))),
  ]
}

test('every file of the feature exists', () => {
  for (const file of NEW_FILES) assert.ok(exists(...file), file.join('/'))
  assert.ok(exists('tests', 'installmentsView.test.cjs'))
})

// --- Navigation -------------------------------------------------------------------

const nav = loadLibModule('navPermissions')
const ready = (keys) => ({
  status: 'ready',
  permissions: new Map(keys.map((key) => [key, 'all'])),
})

test('a hidden top-level entry, gated on installments.view', () => {
  const entry = nav.NAV_ENTRIES.find((item) => item.key === 'installments')
  assert.ok(entry)
  assert.equal(entry.hidden, true)
  assert.deepEqual(plain(entry.requires), [{ key: 'installments.view' }])
  assert.equal(entry.children, undefined)

  // Never listed in the sidebar, whatever the user holds.
  const admin = ready([
    'home.admin',
    'equipment.read',
    'installments.view',
    'installments.manage',
  ])
  const listed = Array.from(nav.visibleNavItems(admin), (item) => item.key)
  assert.ok(listed.includes('equipment'))
  assert.ok(!listed.includes('installments'))
  const shell = nav.planShell(admin)
  assert.ok(
    !Array.from(
      nav.visibleNavItems(admin, shell.pages),
      (item) => item.key,
    ).includes('installments'),
  )

  // Still open by URL for a holder of the key, and for nobody else.
  assert.ok(shell.pages.has('installments'))
  assert.ok(shell.pages.has('installments/:id'))
  const without = nav.planShell(ready(['home.admin', 'equipment.read']))
  assert.ok(!without.pages.has('installments'))
  assert.ok(!without.pages.has('installments/:id'))
  assert.deepEqual(plain(nav.pageGate('installments')), [
    { key: 'installments.view' },
  ])
  assert.deepEqual(plain(nav.pageGate('installments/:id')), [
    { key: 'installments.view' },
  ])
  // installments.manage alone opens nothing: the key requires the view.
  assert.equal(nav.planShell(ready(['installments.manage'])).kind, 'none')

  // Never a landing while a listed section passes; a field home too.
  assert.equal(
    nav.planShell(ready(['equipment.read', 'installments.view'])).landing,
    'equipment',
  )
  assert.equal(nav.planShell(admin).landing, 'dashboard')
  const foreman = nav.planShell(
    ready(['home.foreman', 'movements.read', 'installments.view']),
  )
  assert.equal(foreman.landing, 'dashboard')
  assert.ok(foreman.pages.has('installments'))
  // Like every hidden entry, the last resort of a role that holds nothing
  // else (instead of the no-permissions page).
  const only = nav.planShell(ready(['installments.view']))
  assert.equal(only.kind, 'admin')
  assert.equal(only.landing, 'installments')
})

test('the routes: the list, then any second segment is a contract', () => {
  assert.equal(nav.routePageOf(['installments']), 'installments')
  assert.equal(
    nav.routePageOf(['installments', '0b0e0f6a-1111-4222-8333-444455556666']),
    'installments/:id',
  )
  assert.equal(nav.navKeyOfPage('installments/:id'), 'installments')
  // 0209: the form is a page of its own, for readers who may also write.
  assert.equal(nav.routePageOf(['installments', 'new']), 'installments/new')
  assert.equal(
    nav.routePageOf(['installments', 'abc', 'edit']),
    'installments/:id/edit',
  )
  for (const page of ['installments/new', 'installments/:id/edit']) {
    assert.equal(nav.navKeyOfPage(page), 'installments')
    assert.ok(
      nav
        .planShell(ready(['home.admin', 'installments.view', 'installments.manage']))
        .pages.has(page),
    )
    assert.ok(
      !nav.planShell(ready(['home.admin', 'installments.view'])).pages.has(page),
    )
    assert.ok(
      !nav.planShell(ready(['home.admin', 'installments.manage'])).pages.has(page),
    )
  }
  assert.match(
    APP,
    /page === 'installments\/new' \? \(\s*<InstallmentContractFormScreen\s+contractId=\{null\}\s+onBack=\{goBackTo\('\/installments'\)\}\s+onSaved=\{\(id\) => router\.replace\(/,
  )

  assert.match(
    APP,
    /const InstallmentsScreen = dynamic\(\s*\(\) =>\s*import\('@\/screens\/installments\/InstallmentsScreen'\)/,
  )
  assert.match(
    APP,
    /const InstallmentContractDetail = dynamic\(\s*\(\) =>\s*import\('@\/screens\/installments\/InstallmentContractDetail'\)/,
  )
  assert.match(
    APP,
    /page === 'installments\/:id' \? \(\s*<InstallmentContractDetail\s+contractId=\{detailId\}\s+onBack=\{goBackTo\('\/installments'\)\}/,
  )
  assert.match(
    APP,
    /\{page === 'installments' && \(\s*<InstallmentsScreen \/>/,
  )
  // The sidebar label exists for the type's sake; the entry is never listed.
  assert.match(APP, /installments: \{ label: 'installments', icon: </)
})

test('trail and tab titles of the two pages', () => {
  const t = (key) => `<${key}>`
  const trail = loadLibModule('pageTrail')
  const title = loadLibModule('pageTitle')
  const crumbs = trail.pageTrail('installments/:id', t, 'INS-0003')
  assert.deepEqual(plain(crumbs), {
    crumbs: [
      { label: '<installments>', href: '/installments' },
      { label: 'INS-0003' },
    ],
    parentPath: '/installments',
    parentLabel: '<installments>',
  })
  // 0209: the form's two pages.
  assert.deepEqual(
    plain(trail.pageTrail('installments/new', t, null)).crumbs,
    [
      { label: '<installments>', href: '/installments' },
      { label: '<instContractNew>' },
    ],
  )
  assert.deepEqual(
    plain(
      trail.pageTrail('installments/:id/edit', t, 'INS-0003', {
        recordPath: '/installments/c1',
      }),
    ),
    {
      crumbs: [
        { label: '<installments>', href: '/installments' },
        { label: 'INS-0003', href: '/installments/c1' },
        { label: '<instContractEdit>' },
      ],
      parentPath: '/installments/c1',
      parentLabel: 'INS-0003',
    },
  )
  assert.equal(
    title.tabTitle('installments/new', t, null),
    '<instContractNew> · <installments>',
  )
  const back = loadLibModule('backNavigation')
  const entries = (...paths) =>
    paths.map((path) => ({ url: path, path, merged: false }))
  // Back from a saved new contract: the list, never the form.
  assert.deepEqual(
    plain(
      back.planBack(
        entries('/installments', '/installments/new', '/installments/c1'),
        '/installments',
      ),
    ),
    { kind: 'push', url: '/installments' },
  )
  // Back from a contract reached through its own edit page: not itself.
  assert.deepEqual(
    plain(
      back.planBack(
        entries('/installments', '/installments/c1', '/installments/c1/edit', '/installments/c1'),
        '/installments',
      ),
    ),
    { kind: 'push', url: '/installments' },
  )
  assert.deepEqual(
    plain(
      back.planBack(
        entries('/installments', '/installments/c1', '/installments/c1/edit'),
        '/installments/c1',
      ),
    ),
    { kind: 'history' },
  )
  // The list is a top-level page: no trail.
  assert.equal(trail.pageTrail('installments', t, null), null)
  assert.equal(
    title.tabTitle('installments', t, null),
    '<installments> · <tabAppName>',
  )
  assert.equal(
    title.tabTitle('installments/:id', t, 'INS-0003'),
    'INS-0003 · <installments>',
  )
  assert.equal(
    title.tabTitle('installments/:id', t, null),
    '<installments> · <tabAppName>',
  )
  const page = read(
    'src',
    'screens',
    'installments',
    'InstallmentContractDetail.tsx',
  )
  assert.match(page, /useTabTitle\(data\?\.contract\.contract_number\)/)
  assert.match(page, /<PageTrailBar onBack=\{onBack\}/)
})

// --- The data module --------------------------------------------------------------

/** The parameter names of a 0203 function, in order. */
function sqlParameters(name) {
  const pattern = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\(([\\s\\S]*?)\\)\\s*RETURNS`,
  )
  // The latest definition wins (0208 re-creates the save).
  // 0209 drops and creates what gains a parameter.
  const created = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(([\\s\\S]*?)\\)\\s*RETURNS`,
  )
  const match =
    created.exec(ITEMS_MIGRATION.replace(/--[^\n]*/g, '')) ??
    created.exec(PLAN_MIGRATION.replace(/--[^\n]*/g, '')) ??
    pattern.exec(LATER) ??
    pattern.exec(MIGRATION)
  assert.ok(match, name)
  return [...match[1].matchAll(/\b(p_[a-z_]+)\b/g)].map((item) => item[1])
}

/** The argument names the data module sends to a function. */
function rpcArguments(name) {
  const match = new RegExp(
    `supabase\\.rpc\\('${name}', \\{([\\s\\S]*?)\\}\\)`,
  ).exec(DATA)
  assert.ok(match, name)
  return [...match[1].matchAll(/^\s*(p_[a-z_]+):/gm)].map((item) => item[1])
}

test('the four functions are called with the exact parameter names of 0203', () => {
  const functions = [
    'save_installment_contract',
    'cancel_installment_contract',
    'record_installment_payment',
    'void_installment_payment',
    'set_installment_first_due_date',
    'set_installment_payment_date',
    'installment_contract_edit_key',
    'set_installment_row_note',
  ]
  for (const name of functions)
    assert.deepEqual(rpcArguments(name), sqlParameters(name), name)
  assert.deepEqual(sqlParameters('save_installment_contract'), [
    'p_id',
    'p_description',
    'p_financier_id',
    'p_total_amount',
    'p_down_payment',
    'p_balloon_amount',
    'p_installment_count',
    'p_frequency_months',
    'p_first_due_date',
    'p_notes',
    'p_equipment_ids',
    'p_account',
    'p_vat',
    'p_first_payments',
    'p_expected_key',
    'p_items',
  ])
  // Only those (0209 adds the two dates), the delete of 0207, and nothing the migration keeps
  // for itself.
  assert.deepEqual(
    [...DATA.matchAll(/\.rpc\('([a-z_]+)'/g)].map((item) => item[1]).sort(),
    [...functions, 'delete_installment_contract'].sort(),
  )
  assert.doesNotMatch(
    DATA,
    /generate_installment_schedule|next_installment_contract_number|assert_installment/,
  )
})

/** The body of a view or a table of the migration. */
function relationBody(name) {
  // 0206 re-created the payments list with the receipt columns appended.
  const replaced = new RegExp(
    `CREATE OR REPLACE VIEW public\\.${name}\\b([\\s\\S]*?)COMMENT ON VIEW public\\.${name}\\b`,
  ).exec(RECEIPTS_MIGRATION)
  if (replaced) return replaced[1]
  const view = new RegExp(
    `CREATE VIEW public\\.${name}\\b([\\s\\S]*?)COMMENT ON VIEW public\\.${name}\\b`,
  ).exec(MIGRATION)
  if (view) return view[1]
  const table = new RegExp(
    `CREATE TABLE public\\.${name} \\(([\\s\\S]*?)\\n\\);`,
  ).exec(MIGRATION)
  assert.ok(table, name)
  return table[1]
}

/** What 0209 (or 0210) gives a relation: its re-created view, or its new
 *  columns. */
function planBody(name, source = PLAN_MIGRATION) {
  const view = new RegExp(
    `CREATE OR REPLACE VIEW public\\.${name}\\b([\\s\\S]*?);\\n`,
  ).exec(source)
  if (view) return view[1]
  return [
    ...source.matchAll(
      new RegExp(`ALTER TABLE public\\.${name}\\n([\\s\\S]*?);\\n`, 'g'),
    ),
  ]
    .map((match) => match[1])
    .join('\n')
}

function assertColumns(relation, columns) {
  const body = relationBody(relation)
  for (const column of columns)
    assert.ok(
      new RegExp(`\\b${column}\\b`).test(body) ||
        // 0208 appends the account columns.
        new RegExp(`\\b(AS|ADD COLUMN) ${column}\\b`).test(LATER) ||
        new RegExp(`\\b${column}\\b`).test(planBody(relation)) ||
        new RegExp(`\\b${column}\\b`).test(
          planBody(relation, ITEMS_MIGRATION),
        ),
      `${relation}.${column}`,
    )
}

const selectOf = (name) => {
  const match = new RegExp(`export const ${name} =\\s*'([^']+)'`).exec(DATA)
  assert.ok(match, name)
  return match[1]
}

test('the selects name only columns the views and tables have', () => {
  const plainSelects = {
    INSTALLMENT_OVERVIEW_SELECT: 'installment_overview',
    INSTALLMENT_DUE_SELECT: 'installment_dues',
    INSTALLMENT_CONTRACT_SELECT: 'installment_contract_summary',
    INSTALLMENT_SCHEDULE_SELECT: 'installment_schedule',
    INSTALLMENT_PAYMENT_SELECT: 'installment_payment_list',
    INSTALLMENT_FINANCIER_SELECT: 'installment_financiers',
  }
  // 0210: the items, a table of its own.
  const itemsTable =
    /CREATE TABLE public\.installment_contract_items \(([\s\S]*?)\n\);/.exec(
      ITEMS_MIGRATION,
    )
  assert.ok(itemsTable)
  for (const column of selectOf('INSTALLMENT_ITEM_SELECT').split(','))
    assert.match(itemsTable[1], new RegExp(`\\b${column}\\b`), column)
  for (const [name, relation] of Object.entries(plainSelects)) {
    const select = selectOf(name)
    assert.doesNotMatch(select, /\*/, name)
    assertColumns(relation, select.split(','))
  }
  // The two embeds: the unit of a link, the schedule row of an allocation.
  assert.equal(
    selectOf('INSTALLMENT_UNIT_SELECT'),
    'contract_id,equipment_id,equipment(code,type)',
  )
  assertColumns('installment_contract_equipment', [
    'contract_id',
    'equipment_id',
  ])
  assert.equal(
    selectOf('INSTALLMENT_ALLOCATION_SELECT'),
    'payment_id,amount,installment_schedule!inner(seq,kind,title,contract_id)',
  )
  assertColumns('installment_payment_allocations', [
    'payment_id',
    'amount',
    'schedule_id',
  ])
  assertColumns('installment_schedule', ['seq', 'contract_id'])

  // The columns the module filters and sorts by.
  assertColumns('installment_dues', [
    'contract_status',
    'is_paid',
    'days_until_due',
    'due_date',
    'financier_id',
    'contract_number',
    'seq',
    'remaining_amount',
  ])
  assertColumns('installment_contract_summary', [
    'status',
    'overdue_count',
    'financier_id',
    'remaining_total',
    'next_due_date',
    'description',
    'contract_number',
    'financier_name',
  ])
  // No `select('*')` anywhere.
  assert.doesNotMatch(DATA, /select\(\s*['"`]\*/)
})

test('reads only the installments relations; writes only the financiers', () => {
  const relations = new Set(
    [...DATA.matchAll(/\.from\('([a-z_]+)'\)/g)].map((item) => item[1]),
  )
  assert.deepEqual([...relations].sort(), [
    'equipment',
    'installment_contract_equipment',
    'installment_contract_files',
    'installment_contract_items',
    'installment_contract_summary',
    'installment_contracts',
    'installment_dues',
    'installment_financiers',
    'installment_overview',
    'installment_payment_allocations',
    'installment_payment_list',
    'installment_schedule',
  ])
  // Every direct write is on installment_financiers and is read back.
  const writes = [
    ...DATA.matchAll(
      /\.from\('([a-z_]+)'\)\s*\.(insert|update|delete|upsert)\(/g,
    ),
  ]
  assert.deepEqual(writes.map((item) => `${item[1]}.${item[2]}`).sort(), [
    'installment_financiers.delete',
    'installment_financiers.insert',
    'installment_financiers.update',
  ])
  assert.equal(
    [...DATA.matchAll(/\.(insert|update|delete|upsert)\(/g)].length,
    3,
  )
  for (const name of [
    'insertInstallmentFinancier',
    'updateInstallmentFinancier',
    'deleteInstallmentFinancier',
  ]) {
    const body = DATA.slice(DATA.indexOf(`export async function ${name}`))
    assert.match(body.slice(0, body.indexOf('\n}\n')), /\.select\('id'\)/, name)
  }
  // A refusal by the row policy is told apart from a database error.
  assert.match(DATA, /refused: result\.error\.code === '42501'/)
  assert.match(DATA, /: \{ ok: false, refused: true, error: null \}/)
})

test('every read is bounded or paged, and throws on failure', () => {
  for (const [name, cap] of [
    ['DUES_TOTAL_CAP', 5000],
    ['INSTALLMENT_OPTION_LIMIT', 20],
  ])
    assert.match(DATA, new RegExp(`export const ${name} = ${cap}\\b`))
  // A capped read says when it reached its cap.
  assert.match(DATA, /partial: rows\.length >= DUES_TOTAL_CAP/)
  assert.match(DATA, /partial: rows\.length >= FINANCIER_CONTRACTS_CAP/)
  // Each exported reader limits, ranges, counts or reads one row.
  const readers = DATA.split(/\nexport async function /).slice(1)
  for (const reader of readers) {
    const name = reader.slice(0, reader.indexOf('('))
    if (/^(save|set|cancel|record|void|insert|update|delete)Installment/.test(name))
      continue
    const body = reader.slice(0, reader.indexOf('\n}\n'))
    assert.match(
      body,
      /\.limit\(|\.range\(|head: true|\.maybeSingle\(\)|fetchContractRow\(|fetchSchedule\(/,
      name,
    )
  }
  // The dues and contracts lists are searched, filtered, sorted and paged
  // by the server.
  assert.match(
    DATA,
    /buildSearchFilter\(\s*installmentContractsListConfig\.searchFields/,
  )
  assert.match(DATA, /buildSearchFilter\(\s*installmentDuesListConfig\.searchFields/)
  assert.match(DATA, /applyListFilters\(/)
  assert.match(
    DATA,
    /\.eq\('contract_status', 'active'\)\s*\.eq\('is_paid', false\)/,
  )
  assert.match(DATA, /\.eq\('status', 'active'\)\.gt\('overdue_count', 0\)/)
  assert.match(DATA, /query\.page \* query\.pageSize - 1/)
  // A failed read throws: a screen shows its error state, never «no data».
  assert.match(DATA, /throw new SupabaseLoadError\(\)/)
  assert.match(DATA, /unwrapRows</)
  assert.doesNotMatch(codeOf(DATA), /\?\? \[\]\s*\n\s*\}\s*catch/)
})

// --- The screens ------------------------------------------------------------------

test('the screens never touch the database themselves', () => {
  for (const file of UI_FILES) {
    const source = read(...file)
    assert.doesNotMatch(source, /from '@\/lib\/supabase'/, file.join('/'))
    assert.doesNotMatch(
      source,
      /\.rpc\(|\.from\('|\.insert\(|\.upsert\(/,
      file.join('/'),
    )
  }
})

test('write actions show for installments.manage only', () => {
  const list = read('src', 'screens', 'installments', 'InstallmentsScreen.tsx')
  const page = read('src', 'screens', 'installments', 'InstallmentContractDetail.tsx')
  for (const source of [list, page]) {
    assert.match(source, /const canManage = can\('installments\.manage'\)/)
    assert.match(source, /<ToastProvider>/)
    // The dialogs are not even mounted for a reader.
    assert.match(source, /\{canManage && \(\s*<>\s*<SetFirstDueDateDialog/)
  }
  assert.match(list, /const actions = canManage \? \(/)
  // A cancelled contract keeps «خيارات» for «حذف العقد» (0207).
  assert.match(page, /const showActions = canManage\n/)
  assert.match(page, /canVoid=\{canManage && !cancelled\}/)
  assert.match(page, /canManage=\{canManage && !cancelled\}/)
  assert.match(page, /canAct=\{canManage && active\}/)
  assert.match(page, /action=\{canManage && active \? payButton : undefined\}/)
  // The «تسديد» buttons of the cards, the calendar and the feed follow the key.
  for (const file of [
    'InstallmentsDashboardTab.tsx',
    'InstallmentsContractsTab.tsx',
    'InstallmentsCalendarTab.tsx',
    'InstallmentsDuesTab.tsx',
  ])
    assert.match(read('src', 'components', 'installments', file), /canPay=\{canManage\}/, file)
  assert.match(
    read('src', 'components', 'installments', 'InstallmentsFinanciersTab.tsx'),
    /\{canManage && \(/,
  )
  // No screen tests a role name.
  for (const file of UI_FILES)
    assert.doesNotMatch(read(...file), /role === '|profile\.role|is_admin/, file.join('/'))
})

test('one page with five tabs, kept in the URL', () => {
  const list = read('src', 'screens', 'installments', 'InstallmentsScreen.tsx')
  for (const tab of ['dashboard', 'calendar', 'dues', 'contracts', 'financiers']) {
    assert.match(list, new RegExp('<TabsTrigger value="' + tab + '">'))
    assert.match(list, new RegExp('<TabsContent value="' + tab + '"'))
  }
  for (const piece of [
    '<InstallmentsDashboardTab',
    '<InstallmentsCalendarTab',
    '<InstallmentsContractsTab',
    '<InstallmentsDuesTab',
    '<InstallmentsFinanciersTab',
    '<SetFirstDueDateDialog',
    '<InstallmentPaymentDialog',
    '<InstallmentFinancierDialog',
  ])
    assert.ok(list.includes(piece), piece)
  assert.match(list, /useInstallmentsUrl\(\)/)
  const hook = read('src', 'components', 'installments', 'useInstallmentsUrl.ts')
  assert.match(hook, /window\.history\.replaceState\(/)
  assert.match(hook, /readInstallmentsUrlState\(/)
  // The dues view and financier, the contracts chip, sort and search live in the URL.
  const view = read('src', 'lib', 'installmentsView.ts')
  for (const key of ["feedFinancier: 'fin'", "contractChip: 'chip'", "contractSort: 'csort'", "contractSearch: 'cq'"])
    assert.ok(view.includes(key), key)
  // A new contract opens its own page, which shows the message.
  assert.match(list, /<AppLink href="\/installments\/new">/)
  const form = read('src', 'screens', 'installments', 'InstallmentContractFormScreen.tsx')
  assert.match(form, /'instToastContractCreated'[\s\S]{0,120}onSaved\(result\.data\)/)
  assert.match(
    read('src', 'screens', 'installments', 'InstallmentContractDetail.tsx'),
    /takeInstallmentFlash\(\)/,
  )
})

test('a failed load is an error state with a retry, never an empty list', () => {
  for (const file of [
    ['src', 'screens', 'installments', 'InstallmentsScreen.tsx'],
    ['src', 'screens', 'installments', 'InstallmentContractDetail.tsx'],
    ['src', 'components', 'installments', 'InstallmentsDashboardTab.tsx'],
    ['src', 'components', 'installments', 'InstallmentsContractsTab.tsx'],
    ['src', 'components', 'installments', 'InstallmentsDuesTab.tsx'],
    ['src', 'components', 'installments', 'InstallmentsFinanciersTab.tsx'],
  ]) {
    const source = read(...file)
    assert.match(
      source,
      /load\.status === 'failed'[\s\S]{0,160}<ErrorState[\s\S]{0,120}onRetry=\{load\.reload\}/,
      file.join('/'),
    )
  }
  const hook = read('src', 'components', 'installments', 'useLoad.ts')
  assert.match(hook, /setState\(\{ status: 'failed', data: null \}\)/)
  assert.match(hook, /controller\.abort\(\)/)
  // The loading states are skeletons.
  assert.match(
    read('src', 'screens', 'installments', 'InstallmentsScreen.tsx'),
    /<Skeleton /,
  )
  assert.match(
    read('src', 'screens', 'installments', 'InstallmentContractDetail.tsx'),
    /function PageSkeleton\(/,
  )
})

test('a contract opens through real links', () => {
  for (const file of ['boardParts.tsx', 'InstallmentsDuesTab.tsx', 'InstallmentsCalendarTab.tsx'])
    assert.match(
      read('src', 'components', 'installments', file),
      /<AppLink\s+href=\{`\/installments\/\$\{(contract\.id|row\.contract_id)\}`\}/,
      file,
    )
})

test('the reads are server-side and bounded', () => {
  const data = read('src', 'lib', 'installmentsData.ts')
  for (const name of ['fetchDuesFeed', 'fetchContractCards', 'fetchDuesWithin', 'fetchContractsByIds'])
    assert.match(data, new RegExp('export async function ' + name + '\\('), name)
  // Every new read limits its rows.
  const board = data.slice(data.indexOf('// --- The unified page'))
  const readers = board.split(/\nexport async function /).slice(1)
  for (const reader of readers) assert.match(reader, /\.limit\(/, reader.slice(0, 40))
  for (const name of ['CONTRACT_FIGURES_CAP', 'CALENDAR_ROWS_CAP', 'CASHFLOW_ROWS_CAP'])
    assert.match(board, new RegExp('partial: rows\\.length >= ' + name), name)
  const contracts = read('src', 'components', 'installments', 'InstallmentsContractsTab.tsx')
  assert.doesNotMatch(contracts, /\.sort\(|\.filter\(\(row\)/)
  const dues = read('src', 'components', 'installments', 'InstallmentsDuesTab.tsx')
  assert.match(dues, /setLimit\(\(current\) => current \+ DUES_FEED_PAGE\)/)
})

// Owner 2026-11-23: «شيل المتبقي على العقود, وخلي فلتر الجهة وفلتر … فوق
// القائمة», «استبدل اسم العقد باسم القسط, وممكن تضيف اسم العقد تحته».
// Owner 2026-11-23: «ارقام الايام خليها بولد او اللي بعده», «سوي انيميشن
// لصفحة الاستحقاقات».
test('the dues: heavier day numbers, the cards rise in', () => {
  const dues = read('src', 'components', 'installments', 'InstallmentsDuesTab.tsx')
  // «فيه مشكلة في النقل بين المسدد غير المسدد الكل»: the rows are grouped
  // by the view they were read for, and a new view mounts a new list.
  assert.match(dues, /groupDues\(load\.data\?\.rows \?\? \[\], shownView, today\)/)
  assert.match(dues, /key=\{listKey\}/)
  assert.match(dues, /switching && 'opacity-50'/)
  assert.match(dues, /text-xl font-extrabold leading-none tabular-nums/)
  assert.match(dues, /'dues-rise relative flex/)
  assert.match(dues, /style=\{riseDelay\(order\)\}/)
  const css = read('src', 'index.css')
  assert.match(css, /@keyframes dues-rise/)
  assert.match(css, /prefers-reduced-motion: reduce\) \{\n  \.dues-rise \{\n    animation: none;/)
})

test('the dues: the filters over the list, the installment named first', () => {
  const dues = read('src', 'components', 'installments', 'InstallmentsDuesTab.tsx')
  assert.doesNotMatch(dues, /instRemainingOnContracts|summarizeContracts|overview/)
  const feed = dues.slice(dues.indexOf('const feed = ('), dues.indexOf('const side = ('))
  assert.ok(feed.indexOf('{filters}') < feed.indexOf("load.status === 'failed'"))
  const filters = dues.slice(dues.indexOf('const filters = ('), dues.indexOf('const feed = ('))
  assert.match(filters, /DUES_FEED_VIEWS\.map/)
  assert.match(filters, /instAllFinanciers/)
  // «حقل اختيار الجهة فيه بحث»: a searchable picker over the loaded list.
  assert.match(filters, /<AsyncSearchSelect/)
  assert.match(dues, /normalizeSearchText\(row\.name\)\.includes\(needle\)/)
  assert.doesNotMatch(dues, /<Select\b/)
  const row = dues.slice(dues.indexOf('function FeedRow('))
  assert.ok(
    row.indexOf('payableRowLabel(row, t, row.installment_count)') < row.indexOf('{row.description}'),
  )
  assert.doesNotMatch(
    read('src', 'screens', 'installments', 'InstallmentsScreen.tsx'),
    /<InstallmentsDuesTab[^>]*overview=/,
  )
})

test('the contract page: schedule, payments, units and a derived history', () => {
  const page = read(
    'src',
    'screens',
    'installments',
    'InstallmentContractDetail.tsx',
  )
  assert.match(page, /fetchInstallmentContract\(contractId, signal\)/)
  assert.match(page, /contractHistory\(data\.contract, data\.payments, data\.files\)/)
  assert.match(page, /allocationSeqsByPayment\(data\?\.allocations \?\? \[\]\)/)
  for (const piece of [
    '<DetailHeader',
    '<PaidProgress',
    '<DescriptionList items={facts}',
    'function PaymentCard(',
    '<VoidInstallmentPaymentDialog',
    '<CancelInstallmentContractDialog',
    'sm:hidden',
    'env(safe-area-inset-bottom)',
  ])
    assert.ok(page.includes(piece), piece)
  // «خيارات»: edit always, cancel for an active contract without a posted
  // payment.
  assert.match(
    page,
    /const locked = payments\.some\(\(payment\) => payment\.status === 'posted'\)/,
  )
  assert.match(page, /disabled=\{locked\}/)
  // 0209: edit is a link to the form's page; the date may change until an
  // installment is paid.
  assert.match(page, /<AppLink href=\{`\/installments\/\$\{contract\.id\}\/edit`\}>/)
  assert.match(page, /active && !awaiting && !contract\.installments_locked/)
  // The view counts the late rows of a closed contract too.
  assert.match(
    page,
    /const overdueCount = active \? contract\.overdue_count : 0/,
  )
  // Saudi days for the stored instants.
  assert.match(page, /formatDate\(saudiDateKey\(contract\.created_at\)\)/)
})

// --- The dialogs and their rules -----------------------------------------------------

const v = loadLibModule('formValidation')
const contractValues = (patch = {}) => ({
  description: 'حفار كاتربيلر 320',
  financier_id: '0b0e0f6a-1111-4222-8333-444455556666',
  total_amount: '1,200,000',
  down_payment: '120000',
  balloon_amount: '',
  installment_count: '36',
  frequency_months: '1',
  first_due_date: '2026-12-01',
  notes: '',
  equipment: [],
  vat_mode: 'none',
  vat_title: '',
  vat_note: '',
  vat_amount: '',
  vat_due: 'undecided',
  vat_due_date: '',
  vat_paid: false,
  vat_paid_on: '',
  vat_method: 'transfer',
  payments: [],
  ...patch,
})

test('installmentContractFormSchema: the rules of the contract form', () => {
  const check = (patch) =>
    plain(
      v.validateWithSchema(
        v.installmentContractFormSchema('2026-11-22'),
        contractValues(patch),
      ),
    )
  assert.deepEqual(check(), {})
  assert.deepEqual(check({ description: '  ' }), {
    description: 'instErrDescription',
  })
  assert.deepEqual(check({ description: 'x'.repeat(201) }), {
    description: 'instErrDescription',
  })
  assert.deepEqual(check({ financier_id: '' }), {
    financier_id: 'instErrFinancier',
  })
  assert.deepEqual(check({ total_amount: '' }), {
    total_amount: 'instTotalRequired',
  })
  assert.deepEqual(check({ total_amount: '12.345' }), {
    total_amount: 'instAmountFormat',
  })
  assert.deepEqual(check({ down_payment: 'abc' }), {
    down_payment: 'instAmountFormat',
  })
  assert.deepEqual(check({ installment_count: '' }), {
    installment_count: 'instErrInstallmentCount',
  })
  assert.deepEqual(check({ frequency_months: '4' }), {
    frequency_months: 'instErrFrequency',
  })
  // 0209: the first due date may be unknown; a wrong one is refused.
  assert.deepEqual(check({ first_due_date: '' }), {})
  assert.deepEqual(check({ first_due_date: '1/12/2026' }), {
    first_due_date: 'instErrFirstDueDate',
  })
  assert.deepEqual(check({ vat_mode: '' }), { vat_mode: 'instErrVat' })
  assert.deepEqual(check({ vat_mode: 'unspecified' }), {})
  assert.deepEqual(check({ vat_mode: 'inside' }), {})
  assert.deepEqual(check({ vat_mode: 'separate' }), {})
  assert.deepEqual(check({ vat_mode: 'separate', vat_amount: '0' }), {
    vat_amount: 'instErrVatAmount',
  })
  assert.deepEqual(check({ vat_mode: 'separate', vat_due: 'date' }), {
    vat_due_date: 'instErrVatDate',
  })
  // Paid: its planned day is hidden, the day it was paid is asked.
  assert.deepEqual(
    check({ vat_mode: 'separate', vat_due: 'date', vat_paid: true, vat_paid_on: '2026-11-20' }),
    {},
  )
  assert.deepEqual(
    check({ vat_mode: 'separate', vat_paid: true, vat_paid_on: '2026-11-23' }),
    { vat_paid_on: 'instErrPaidOn' },
  )
  const row = (patch = {}) => ({
    key: 'k', id: null, title: 'الدفعة الاولى', kind: 'rate', value: '20',
    date: '', paidOn: '', note: '', paid: false, method: 'transfer', lockedAmount: null,
    settled: false, ...patch,
  })
  assert.deepEqual(check({ payments: [row()] }), {})
  for (const wrong of [
    { title: ' ' },
    { value: '100' },
    { value: '0' },
    { paid: true },
    { paid: true, paidOn: '2026-11-23' },
  ])
    assert.deepEqual(check({ payments: [row(wrong)] }), {
      payments: 'instFpCheckRows',
    })
  // Paid before the first due date is known.
  assert.deepEqual(
    check({ first_due_date: '', payments: [row({ paid: true, date: '2026-12-15', paidOn: '2026-11-20' })] }),
    {},
  )
  assert.deepEqual(check({ payments: [row({ kind: 'amount', value: '1080000' })] }), {
    payments: 'instErrFirstPayments',
  })
  assert.deepEqual(check({ notes: 'x'.repeat(1001) }), {
    notes: 'instErrNotes',
  })
  // The money terms: the token the database would raise, under its field.
  assert.deepEqual(check({ down_payment: '1200000' }), {
    down_payment: 'instErrDownPayment',
  })
  assert.deepEqual(check({ installment_count: '361' }), {
    installment_count: 'instErrInstallmentCount',
  })
  assert.deepEqual(check({ balloon_amount: '1080000' }), {
    balloon_amount: 'instErrBalloon',
  })
  assert.deepEqual(check({ installment_count: '1', balloon_amount: '5000' }), {
    balloon_amount: 'instErrBalloon',
  })
  assert.deepEqual(check({ total_amount: '0' }), {
    total_amount: 'instErrAmount',
  })
  // A balloon as the last of several payments is fine.
  assert.deepEqual(
    check({
      total_amount: '100000',
      down_payment: '0',
      balloon_amount: '40000',
      installment_count: '5',
      frequency_months: '3',
    }),
    {},
  )
})

test('the payment, reason and financier schemas', () => {
  const today = '2026-11-18'
  const payment = (patch = {}) =>
    plain(
      v.validateWithSchema(v.installmentPaymentFormSchema(today), {
        contract_id: 'c1',
        amount: '30000',
        paid_on: today,
        method: 'transfer',
        reference: '',
        note: '',
        ...patch,
      }),
    )
  assert.deepEqual(payment(), {})
  assert.deepEqual(payment({ contract_id: '' }), {
    contract_id: 'instPayContractRequired',
  })
  assert.deepEqual(payment({ amount: '' }), { amount: 'instErrPaymentAmount' })
  assert.deepEqual(payment({ amount: '0' }), { amount: 'instErrPaymentAmount' })
  assert.deepEqual(payment({ amount: '1.999' }), {
    amount: 'instErrPaymentAmount',
  })
  // Not after the Saudi today; an earlier day is fine.
  assert.deepEqual(payment({ paid_on: '2026-11-19' }), {
    paid_on: 'instErrPaidOn',
  })
  assert.deepEqual(payment({ paid_on: '2026-01-01' }), {})
  assert.deepEqual(payment({ paid_on: '' }), { paid_on: 'instPaidOnRequired' })
  assert.deepEqual(payment({ method: 'card' }), { method: 'instErrMethod' })
  assert.deepEqual(payment({ reference: 'x'.repeat(81) }), {
    reference: 'instErrReference',
  })
  assert.deepEqual(payment({ note: 'x'.repeat(501) }), { note: 'instErrNote' })

  const reason = (value) =>
    plain(
      v.validateWithSchema(v.installmentReasonFormSchema, { reason: value }),
    )
  assert.deepEqual(reason('ادخل بالخطا'), {})
  assert.deepEqual(reason('   '), { reason: 'instReasonRequired' })
  assert.deepEqual(reason('x'.repeat(501)), { reason: 'instErrReasonRequired' })

  const financier = (name) =>
    plain(v.validateWithSchema(v.installmentFinancierFormSchema, { name }))
  assert.deepEqual(financier('بنك الراجحي'), {})
  assert.deepEqual(financier(' '), { name: 'instFinancierNameRequired' })
  assert.deepEqual(financier('x'.repeat(121)), {
    name: 'instFinancierNameTooLong',
  })
})

test('the contract page: one save, a live breakdown, the locked terms', () => {
  const dialog = read(
    'src',
    'screens',
    'installments',
    'InstallmentContractFormScreen.tsx',
  )
  assert.match(dialog, /label=\{t\('instContractTitle'\)\}\s+required/)
  assert.match(dialog, /installmentContractFormSchema\(today\)/)
  assert.equal([...dialog.matchAll(/saveInstallmentContract\(/g)].length, 1)
  // The breakdown is live, and shows a VAT already paid as paid.
  assert.match(
    dialog,
    /<InstallmentPlanSummary values=\{values\} vatSettled=\{vatSettled\} \/>/,
  )
  // Money on an installment: the notice and the disabled terms; their
  // values are the stored ones, so they go back as they are.
  assert.match(dialog, /\{termsLocked && \(\s*<Notice tone="info"/)
  assert.ok([...dialog.matchAll(/disabled=\{termsLocked\}/g)].length >= 4)
  assert.match(dialog, /const termsLocked = contract\?\.installments_locked === true/)
  // Leaving with unsaved changes asks.
  assert.match(dialog, /confirmLeave=\{confirmLeave\}/)
  assert.match(dialog, /addEventListener\('beforeunload', warn\)/)
  // The units: optional, searched on the server, 20 at most.
  assert.match(dialog, /<OptionalLabel text=\{t\('instLinkedUnits'\)\} \/>/)
  assert.match(dialog, /<AsyncMultiSelect/)
  assert.match(dialog, /loadOptions=\{loadInstallmentEquipmentOptions\}/)
  assert.match(
    DATA,
    /export async function loadInstallmentEquipmentOptions[\s\S]*?\.limit\(INSTALLMENT_OPTION_LIMIT\)[\s\S]*?buildSearchFilter\(\s*EQUIPMENT_CODE_TYPE_SEARCH_FIELDS/,
  )
  // A refusal goes to its field or to the form's message, never raw.
  assert.match(
    dialog,
    /installmentFieldError\(\s*result\.error,\s*INSTALLMENT_CONTRACT_TOKEN_FIELDS/,
  )
  assert.match(
    dialog,
    /setFormError\(installmentErrorMessage\(result\.error\)\)/,
  )
})

test('the payment and reason dialogs', () => {
  const pay = read(
    'src',
    'components',
    'installments',
    'InstallmentPaymentDialog.tsx',
  )
  assert.match(pay, /installmentPaymentFormSchema\(today\)/)
  assert.equal([...pay.matchAll(/recordInstallmentPayment\(/g)].length, 1)
  assert.match(pay, /allocateToRows\(/)
  assert.match(pay, /max=\{today\}/)
  assert.match(pay, /loadOptions=\{loadActiveContractOptions\}/)
  assert.match(pay, /INSTALLMENT_PAYMENT_TOKEN_FIELDS/)
  assert.match(pay, /context\.status === 'failed'/)
  const reasons = read(
    'src',
    'components',
    'installments',
    'InstallmentReasonDialogs.tsx',
  )
  assert.match(reasons, /installmentReasonFormSchema/)
  assert.match(reasons, /voidInstallmentPayment\(payment\.id, reason\)/)
  assert.match(reasons, /cancelInstallmentContract\(contract\.id, reason\)/)
  assert.match(reasons, /label=\{t\('instReason'\)\}\s+required/)
  const financier = read(
    'src',
    'components',
    'installments',
    'InstallmentFinancierDialog.tsx',
  )
  assert.match(financier, /installmentFinancierFormSchema/)
  assert.match(financier, /setFormError\('instErrManageRequired'\)/)
  assert.match(financier, /message === 'instErrFinancierDuplicate'/)
  // A raw database message never reaches the screen.
  for (const file of UI_FILES)
    assert.doesNotMatch(
      read(...file),
      /error\.message|error\.details|error\.hint/,
      file.join('/'),
    )
})

// --- Copy and tokens ------------------------------------------------------------------

test('the screen keys: Arabic and English together, plain alif', () => {
  const blocks = screenBlocks()
  assert.equal(blocks.length, 2)
  const [ar, en] = blocks
  assert.deepEqual(keysOf(ar), keysOf(en))
  assert.ok(keysOf(ar).length > 150)
  assert.equal(new Set(keysOf(ar)).size, keysOf(ar).length)
  assert.doesNotMatch(ar, /[أإآ]/)
  assert.match(ar, /installments: 'الاقساط',/)
  assert.match(ar, /instContractTitle: 'عنوان العقد',/)
  assert.match(en, /installments: 'Installments',/)
  // The English block holds no Arabic letters.
  assert.doesNotMatch(en, /[؀-ۿ]/)
})

test('every key the new files use exists in both languages', () => {
  const [ar, en] = languageKeys()
  const used = new Set()
  for (const file of [...NEW_FILES, ['src', 'lib', 'installments.ts']]) {
    const source = read(...file)
    for (const match of source.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g))
      used.add(match[1])
    for (const match of source.matchAll(/'(inst[A-Z][A-Za-z0-9]*)'/g))
      used.add(match[1])
  }
  const schemas = read('src', 'lib', 'formValidation.ts')
  for (const match of schemas.matchAll(/'(inst[A-Z][A-Za-z0-9]*)'/g))
    used.add(match[1])
  assert.ok(used.size > 150)
  for (const key of used) {
    assert.ok(ar.has(key), `ar: ${key}`)
    assert.ok(en.has(key), `en: ${key}`)
  }
  // Nothing the screens show is written in the source: no Arabic text
  // outside the comments of the rendering files.
  for (const file of UI_FILES)
    assert.doesNotMatch(codeOf(read(...file)), /[؀-ۿ]/, file.join('/'))
})

test('tokens only: no palette colours, hex, letter-spacing or uppercase', () => {
  for (const file of NEW_FILES) {
    const source = read(...file)
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, file.join('/'))
    assert.doesNotMatch(
      source,
      /\b(gray|zinc|slate|emerald|green|red|amber|blue)-\d{2,3}\b/,
      file.join('/'),
    )
    assert.doesNotMatch(source, /tracking-|\buppercase\b/, file.join('/'))
    // Logical direction utilities only.
    assert.doesNotMatch(
      source,
      /\b(ml|mr|pl|pr)-\d|\btext-(left|right)\b|\b(left|right)-\d/,
      file.join('/'),
    )
    assert.doesNotMatch(source, /[أإآ]/, file.join('/'))
  }
  // Amounts carry the riyal sign through the one shared cell.
  assert.match(
    read('src', 'components', 'installments', 'cells.tsx'),
    /<RiyalSign className="text-muted" size="0\.8em" \/>/,
  )
})
