// The browser tab's title follows the page (owner 2026-10-25, «اسماء التابات
// تتغير بناء على الصفحة»): the specific part first, « · », then the section;
// the home and the top-level lists end with the app's name.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (...parts) =>
  fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

function loadPageTitle() {
  const code = ts.transpileModule(read('src', 'lib', 'pageTitle.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    require(request) {
      throw new Error(`Unexpected module: ${request}`)
    },
  })
  return exports
}

const { tabTitle } = loadPageTitle()
const t = (key) => `<${key}>`

test('the home and the lists: «name · app»', () => {
  assert.equal(tabTitle('dashboard', t, null), '<dashboard> · <tabAppName>')
  assert.equal(tabTitle('equipment', t, null), '<equipment> · <tabAppName>')
  assert.equal(tabTitle('logs', t, null), '<navLogs> · <tabAppName>')
})

test('a sub-page: «name · section»', () => {
  assert.equal(
    tabTitle('purchasing/units', t, null),
    '<siteUnits> · <purchasing>',
  )
  assert.equal(
    tabTitle('purchasing/orders', t, null),
    '<supplierPos> · <purchasing>',
  )
  assert.equal(
    tabTitle('settings/roles', t, null),
    '<rolesSettingsTitle> · <settings>',
  )
  assert.equal(
    tabTitle('reports/workshop', t, null),
    '<workshopReports> · <reports>',
  )
})

test('a detail page: «record · section», «section · app» while loading', () => {
  assert.equal(
    tabTitle('purchasing/:id', t, 'SPO260046'),
    'SPO260046 · <supplierPos>',
  )
  assert.equal(
    tabTitle('purchasing/:id', t, null),
    '<supplierPos> · <tabAppName>',
  )
  assert.equal(tabTitle('equipment/:id', t, 'A291'), 'A291 · <equipment>')
  assert.equal(
    tabTitle('movements/:id', t, 'A291 دخول'),
    'A291 دخول · <tabMovements>',
  )
  assert.equal(tabTitle('users/:id', t, 'X'), 'X · <users>')
})

test('a list with an open record dialog, a new movement, the print page', () => {
  assert.equal(tabTitle('drivers', t, 'X'), 'X · <drivers>')
  assert.equal(
    tabTitle('movements/new', t, null, 'exit'),
    '<registerExit> · <tabMovements>',
  )
  assert.equal(tabTitle('print/export', t, null), null)
})

test('the wiring: App sets it, the detail pages name their record', () => {
  const app = read('src', 'App.tsx')
  assert.match(app, /if \(documentTitle\) document\.title = documentTitle/)
  assert.match(
    app,
    /<TabTitleProvider>\s+<AppContent \/>\s+<\/TabTitleProvider>/,
  )
  assert.match(
    read('src', 'screens', 'EquipmentDetail.tsx'),
    /useTabTitle\(equipment\?\.code\)/,
  )
  assert.match(
    read('src', 'screens', 'purchasing', 'SupplierPoDetail.tsx'),
    /useTabTitle\(po\?\.po_number\)/,
  )
  assert.match(
    read('src', 'screens', 'UserDetail.tsx'),
    /useTabTitle\(user\?\.full_name\)/,
  )
  assert.match(
    read('src', 'screens', 'drivers', 'DriverDetailDialog.tsx'),
    /useTabTitle\(open \? driver\?\.full_name : null\)/,
  )
  assert.match(
    read('src', 'screens', 'MovementDetail.tsx'),
    /useTabTitle\(\s+log\?\.equipment\?\.code/,
  )
  // The metadata title would overwrite it on every navigation.
  const layout = read('app', 'layout.tsx')
  assert.doesNotMatch(layout, /^\s+title:/m)
  assert.match(layout, /<title>حركة المعدات<\/title>/)
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of ['tabAppName', 'tabMovements'])
    assert.equal(
      (translations.match(new RegExp(`^    ${key}: '`, 'gm')) ?? []).length,
      2,
      key,
    )
})
