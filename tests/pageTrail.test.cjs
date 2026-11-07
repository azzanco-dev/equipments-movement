const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-11-07: «نبغى نضبط ازرار الرجوع الي عندنا كلها» then «ونضيف
// breadcrumbs», approved on /ui-kit «المسار وازرار الرجوع» as variant «ب»
// (the trail with a small back button before it).

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const load = (...parts) => {
  const code = ts.transpileModule(read(...parts), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, Object, Array, JSON })
  return exports
}
const back = load('src', 'lib', 'backNavigation.ts')
const trail = load('src', 'lib', 'pageTrail.ts')
const plain = (value) => JSON.parse(JSON.stringify(value))

const visit = (urls) => {
  let stack = []
  urls.forEach((url, index) => {
    stack = back.nextTrail(stack, url, index === 0)
  })
  return stack
}

test('the trail: push, back, a query change and a fresh start', () => {
  const list = '/purchasing/orders?filters=draft&page=3'
  let stack = visit([list, '/purchasing/p1'])
  assert.deepEqual(
    plain(stack.map((entry) => entry.url)),
    [list, '/purchasing/p1'],
  )
  // back to the list: the page before is popped
  stack = back.nextTrail(stack, list, false)
  assert.deepEqual(plain(stack), [
    { url: list, path: '/purchasing/orders', merged: false },
  ])
  // a filter change on the same page replaces its entry
  stack = back.nextTrail(stack, '/purchasing/orders?page=4', false)
  assert.deepEqual(plain(stack), [
    { url: '/purchasing/orders?page=4', path: '/purchasing/orders', merged: true },
  ])
  // a reload keeps the trail, a new tab or an outside link starts over
  const two = visit(['/equipment', '/equipment/e1'])
  assert.equal(back.nextTrail(two, '/equipment/e1', true).length, 2)
  assert.deepEqual(
    plain(back.nextTrail(two, '/users/u1', true)),
    [{ url: '/users/u1', path: '/users/u1', merged: false }],
  )
  // bounded
  const many = visit(Array.from({ length: 80 }, (_, i) => `/movements/m${i}`))
  assert.equal(many.length, back.BACK_TRAIL_MAX)
})

test('back: the page before, else the parent list with its last filters', () => {
  // came from the PO page: the browser's back
  assert.deepEqual(
    plain(back.planBack(visit(['/purchasing/p1', '/equipment/e1']), '/equipment')),
    { kind: 'history' },
  )
  // opened directly: the parent list
  assert.deepEqual(plain(back.planBack(visit(['/equipment/e1']), '/equipment?q=A2')), {
    kind: 'push',
    url: '/equipment?q=A2',
  })
  // the page changed its own query after it was entered: straight to the
  // page before (the browser may hold extra entries for this page)
  const merged = back.nextTrail(
    visit(['/settings', '/settings/roles']),
    '/settings/roles?role=admin',
    false,
  )
  assert.deepEqual(plain(back.planBack(merged, '/settings')), {
    kind: 'push',
    url: '/settings',
  })
  assert.equal(back.backTargetPath(visit(['/logs?q=1', '/movements/m1']), '/logs'), '/logs')
  assert.equal(back.backTargetPath(visit(['/movements/m1']), '/logs'), '/logs')
  assert.equal(
    back.backTargetPath(visit(['/purchasing/p1', '/equipment/e1']), '/equipment'),
    '/purchasing/p1',
  )
})

test('the last URL of each list, newest last, bounded', () => {
  let urls = {}
  urls = back.nextLastUrls(urls, '/equipment?q=A')
  urls = back.nextLastUrls(urls, '/logs')
  urls = back.nextLastUrls(urls, '/equipment?q=B')
  assert.deepEqual(plain(urls), { '/logs': '/logs', '/equipment': '/equipment?q=B' })
  assert.equal(back.rememberedUrl(urls, '/equipment'), '/equipment?q=B')
  assert.equal(back.rememberedUrl(urls, '/drivers'), '/drivers')
  for (let i = 0; i < 150; i += 1) urls = back.nextLastUrls(urls, `/p${i}`)
  assert.equal(Object.keys(urls).length, back.LAST_URLS_MAX)
})

test('the crumbs of every page with a trail', () => {
  const t = (key) => `<${key}>`
  const labels = (page, record, options) =>
    plain(trail.pageTrail(page, t, record, options).crumbs.map((c) => [c.label, c.href ?? null]))
  assert.deepEqual(labels('purchasing/:id', 'PO-2026110001'), [
    ['<purchasing>', '/purchasing'],
    ['<supplierPos>', '/purchasing/orders'],
    ['PO-2026110001', null],
  ])
  assert.deepEqual(labels('sales/cards/:id', 'A291'), [
    ['<sales>', '/sales'],
    ['<cardPrices>', '/sales/prices'],
    ['A291', null],
  ])
  assert.deepEqual(labels('equipment/:id', null), [
    ['<equipment>', '/equipment'],
    ['', null],
  ])
  assert.deepEqual(labels('movements/:id', 'A291 دخول', { fieldHome: true }), [
    ['<dashboard>', '/dashboard'],
    ['A291 دخول', null],
  ])
  assert.deepEqual(labels('movements/new', null, { movementType: 'exit' }), [
    ['<navLogs>', '/logs'],
    ['<registerExit>', null],
  ])
  assert.deepEqual(labels('settings/banks', null), [
    ['<settings>', '/settings'],
    ['<banks>', null],
  ])
  // a parent the shell does not open is plain text
  assert.deepEqual(
    labels('purchasing/:id', 'PO-1', { opens: (p) => p !== '/purchasing/orders' })[1],
    ['<supplierPos>', null],
  )
  const spec = trail.pageTrail('users/:id', t, 'خالد')
  assert.equal(spec.parentPath, '/users')
  assert.equal(spec.parentLabel, '<users>')
  for (const page of ['dashboard', 'logs', 'equipment', 'purchasing/orders'])
    assert.equal(trail.pageTrail(page, t, null), null, page)
})

test('App feeds the trail and every detail page uses the back rule', () => {
  const app = read('src', 'App.tsx')
  assert.match(app, /setNavTrail\(recordVisit\(currentUrl, firstVisitRef\.current\)\)/)
  assert.match(app, /<PageTrailProvider value=\{trailValue\}>/)
  for (const fallback of ['/equipment', '/sales/orders', '/sales/prices', '/purchasing/orders', '/drivers', '/users'])
    assert.ok(app.includes(`onBack={goBackTo('${fallback}')}`), fallback)
  assert.doesNotMatch(app, /onBack=\{\(\) => router\.(push|back)/)
  for (const file of [
    ['src', 'screens', 'EquipmentDetail.tsx'],
    ['src', 'screens', 'purchasing', 'SupplierPoDetail.tsx'],
    ['src', 'screens', 'sales', 'ClientPoDetail.tsx'],
    ['src', 'screens', 'sales', 'EquipmentCardDetail.tsx'],
    ['src', 'screens', 'UserDetail.tsx'],
  ]) {
    const source = read(...file)
    assert.match(source, /<PageTrailBar\b/, file.join('/'))
    assert.doesNotMatch(source, /<BackButton onClick=\{onBack\}/, file.join('/'))
  }
  // unsaved changes are asked about before a crumb leaves too
  assert.match(read('src', 'screens', 'UserDetail.tsx'), /confirmLeave=\{confirmLeave\}/)
  assert.match(read('src', 'components', 'roles', 'RolesSettings.tsx'), /confirmLeave=\{confirmDiscard\}/)
  // the settings sub-pages go back by the rule too
  const settings = read('src', 'screens', 'AdminSettings.tsx')
  assert.equal(settings.split('onBack={backToSettings}').length - 1, 4)
  // the header renders the trail, never the bare back button
  const header = read('src', 'components', 'ui', 'PageHeader.tsx')
  assert.match(header, /<PageTrailBar\s+onBack=\{onBack\}/)
})

test('the trail look: a small back button, real links, one line on a phone', () => {
  const bar = read('src', 'components', 'ui', 'PageTrail.tsx')
  assert.match(bar, /hidden min-w-0 items-center gap-2 md:flex/)
  assert.match(bar, /inline-flex h-10 items-center gap-1\.5[^"]*md:hidden/)
  assert.match(bar, /<AppLink\s+href=\{crumb\.href\}/)
  assert.match(bar, /aria-current="page"/)
  assert.match(bar, /aria-label=\{t\('breadcrumbLabel'\)\}/)
  const kit = read('src', 'screens', 'UiKit.tsx')
  assert.match(kit, /id: 'breadcrumbs',[\s\S]*?status: 'approved'/)
})
