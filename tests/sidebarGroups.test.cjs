const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// The sidebar's sections (owner 2026-11-23: model 1 approved in Figma,
// «الرئيسية» / «البيانات» / «المالية» / «الادارة», «المعدات في البيانات»,
// «الاقساط» stays hidden on the site, no fold button).

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

function load(name) {
  const file = path.join(ROOT, 'src', 'lib', `${name}.ts`)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, Map, Set, Array }, { filename: file })
  return exports
}

const lib = load('navGroups')
const keys = (groups) => JSON.parse(JSON.stringify(groups.map((g) => [g.key, g.items.map((i) => i.key)])))

test('the admin menu in its four sections, equipment first under data', () => {
  const admin = ['dashboard', 'logs', 'inquiry', 'equipment', 'projects', 'companies', 'lessors', 'purchasing', 'sales', 'drivers', 'users', 'settings'].map((key) => ({ key }))
  assert.deepEqual(keys(lib.groupNavItems(admin)), [
    ['home', ['dashboard', 'logs', 'inquiry']],
    ['data', ['equipment', 'projects', 'companies', 'lessors', 'drivers']],
    ['finance', ['purchasing', 'sales']],
    ['admin', ['users', 'settings']],
  ])
})

test('an empty section is left out and an unknown item is never dropped', () => {
  assert.deepEqual(keys(lib.groupNavItems([{ key: 'equipment' }, { key: 'settings' }])), [
    ['data', ['equipment']],
    ['admin', ['settings']],
  ])
  assert.deepEqual(keys(lib.groupNavItems([{ key: 'dashboard' }, { key: 'something-new' }])), [
    ['home', ['dashboard']],
    ['admin', ['something-new']],
  ])
  assert.deepEqual(keys(lib.groupNavItems([])), [])
})

test('the sections only display: NAV_ENTRIES keeps its order and installments stays hidden', () => {
  const nav = read('src', 'lib', 'navPermissions.ts')
  assert.ok(nav.indexOf("key: 'purchasing'") < nav.indexOf("key: 'drivers'"), 'the landing order is unchanged')
  assert.match(nav, /key: 'installments',[\s\S]{0,200}hidden: true/)
})

test('the sidebar and the drawer share SidebarNav, with no fold button', () => {
  const layout = read('src', 'components', 'Layout.tsx')
  assert.equal((layout.match(/<SidebarNav\b/g) ?? []).length, 2)
  assert.match(layout, /groupNavItems\(items\)/)
  assert.match(layout, /text-\[11px\] font-medium text-muted/)
  // The selected page and its section BLACK (owner «معليش رجعه اسود»), the
  // selected page of the tree on the light fill, the other labels lighter.
  assert.match(layout, /'bg-primary font-semibold text-primary-contrast'/)
  assert.match(layout, /'bg-surface-hover font-semibold text-fg'/)
  assert.match(layout, /const selected = active \|\| hasActiveChild/)
  assert.match(layout, /const SOFT_TEXT = 'text-\[color-mix\(in_srgb,var\(--fg\)_72%,var\(--bg\)\)\]'/)
  assert.doesNotMatch(layout, /w-\[3px\]/)
  // The pages of a section as a small tree: a line from the section's icon,
  // a curve to each page, the selected page with an arrow at its end.
  assert.match(layout, /h-5 w-3 rounded-es-lg border-b border-s/)
  assert.match(layout, /\{!last && \(/)
  assert.match(layout, /childActive && \(\s+<ChevronDown/)
  assert.doesNotMatch(layout, /nav-active|hover:bg-gray-100/)
  assert.doesNotMatch(layout, /PanelRight|طي القائمة/)
  assert.equal((layout.match(/<WhatsAppStatusIndicator \/>/g) ?? []).length, 2)
})

test('the WhatsApp state keeps its soft box (owner «ليش شلت الخلفية الخضراء حق الواتس»)', () => {
  const component = read('src', 'components', 'WhatsAppGatewayStatus.tsx')
  assert.match(component, /'flex w-full items-center gap-2\.5 rounded-lg px-3 py-2\.5 text-xs font-normal'/)
  assert.match(component, /tone === 'ok' && 'bg-success-soft'/)
  assert.match(component, /tone === 'down' && 'bg-danger-soft'/)
})

test('the four headings exist in both languages, plain alif', () => {
  const translations = read('src', 'i18n', 'translations.ts')
  for (const key of ['navGroupHome', 'navGroupData', 'navGroupFinance', 'navGroupAdmin']) {
    const found = [...translations.matchAll(new RegExp(`\\n    ${key}: '([^']*)'`, 'g'))]
    assert.equal(found.length, 2, key)
    assert.doesNotMatch(found[0][1], /[أإآ]/, key)
  }
})
