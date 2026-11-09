// The app header (owner 2026-11-08, approved on /ui-kit «نموذج الهيدر
// الجديد» as variant «ب»: «اعتمد الشعار مع القائمة الجانبية», «بوابة الواتس
// خليها نفس مكانها», then «Yes, apply it»): the full logo in a block as wide
// as the sidebar with the sidebar toggle, the general search, the Saudi date
// and time, the language and theme, and the user chip with its menu.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

// Loads a `src/lib` module with its `@/lib/...` imports (type imports are
// erased by the transpiler).
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const module = { exports: {} }
  cache.set(file, module.exports)
  const localRequire = (spec) => {
    if (!spec.startsWith('@/')) throw new Error(`unexpected import ${spec}`)
    return load(path.join(ROOT, 'src', `${spec.slice(2)}.ts`))
  }
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: localRequire,
    URLSearchParams,
    Intl,
    Date,
  })
  cache.set(file, module.exports)
  return module.exports
}

const search = load(path.join(ROOT, 'src', 'lib', 'globalSearch.ts'))
const greeting = load(path.join(ROOT, 'src', 'lib', 'homeGreeting.ts'))
const layout = read('src', 'components', 'Layout.tsx')
const header = layout.slice(
  layout.indexOf('<header'),
  layout.indexOf('</header>'),
)
const component = read('src', 'components', 'GlobalSearch.tsx')
const data = read('src', 'lib', 'globalSearchData.ts')

test('the logo block is as wide as the sidebar, with the full logo', () => {
  assert.match(
    header,
    /hidden w-60 shrink-0 items-center border-e px-4 lg:flex/,
  )
  assert.match(header, /src="\/azzanco-logo-full\.png"/)
  assert.match(header, /bg-\[var\(--logo-tile\)\]/)
  assert.match(header, /<AppLink\s+href="\/dashboard"/)
  // No collapse button (owner 2026-11-08, «شيل زر الطي»): the desktop
  // sidebar is always there.
  assert.doesNotMatch(
    layout,
    /sidebarCollapsed|toggleSidebar|PanelRight|PanelLeft/,
  )
  assert.match(
    layout,
    /className="hidden lg:flex w-60 shrink-0 flex-col border-e/,
  )
})

test('WhatsApp stays in the sidebar, never in the header', () => {
  assert.doesNotMatch(header, /WhatsApp|واتس/)
  assert.equal((layout.match(/<WhatsAppStatusIndicator \/>/g) ?? []).length, 2)
})

test('no movement entry and no attention count in the bar', () => {
  assert.doesNotMatch(header, /movements\/new|Attention|انتباه/)
})

test('the date and the 12-hour time are Saudi, drawn after mount', () => {
  assert.match(layout, /function HeaderClock/)
  assert.match(layout, /const \[now, setNow\] = useState<Date \| null>\(null\)/)
  assert.match(
    layout,
    /<bdi className="font-semibold tabular-nums">\s+\{saudiClockLabel\(now, lang\)\}/,
  )
  const clock = (iso, lang) => greeting.saudiClockLabel(new Date(iso), lang)
  // «وخلي الوقت بنظام 12»
  assert.equal(clock('2026-11-08T07:24:00Z', 'ar'), '10:24 ص')
  assert.equal(clock('2026-11-08T07:24:00Z', 'en'), '10:24 AM')
  assert.equal(clock('2026-11-08T21:05:00Z', 'ar'), '12:05 ص')
  assert.equal(clock('2026-11-08T09:00:00Z', 'ar'), '12:00 م')
  assert.equal(clock('2026-11-08T10:30:00Z', 'ar'), '1:30 م')
  assert.equal(clock('2026-11-08T19:59:00Z', 'en'), '10:59 PM')
})

test('the user menu holds the sign out; theme and language only on a phone', () => {
  assert.match(header, /aria-label=\{t\('userMenu'\)\}/)
  assert.match(header, /onSelect=\{\(\) => setLogoutOpen\(true\)\}/)
  assert.doesNotMatch(layout, /CircleUserRound/)
  // «مايحتاج تكرر الوضع الداكن والانقليزي في قائمة البروفايل»: the bar's
  // icons show from sm, the menu items below sm only.
  const menu = header.slice(header.indexOf('<DropdownMenuContent'))
  assert.match(
    menu,
    /className="sm:hidden"\s+icon=\{\s+theme === 'dark'[\s\S]*?onSelect=\{toggleTheme\}/,
  )
  assert.match(
    menu,
    /className="sm:hidden"\s+icon=\{<Languages size=\{16\} \/>\}\s+onSelect=\{toggleLanguage\}/,
  )
  assert.match(menu, /<DropdownMenuSeparator className="sm:hidden" \/>/)
  assert.match(
    header,
    /<span className="hidden items-center gap-0\.5 sm:flex">/,
  )
})

test('the search offers only the groups whose page the shell opens', () => {
  const ids = (open) =>
    Array.from(
      search.globalSearchGroupsFor((page) => open.includes(page)),
      (g) => g.id,
    )
  assert.deepEqual(ids([]), [])
  assert.deepEqual(ids(['equipment/:id', 'purchasing/:id']), [
    'equipment',
    'purchaseOrders',
  ])
  assert.deepEqual(
    ids([
      'equipment/:id',
      'drivers/:id',
      'companies',
      'projects',
      'purchasing/:id',
    ]),
    ['equipment', 'drivers', 'companies', 'projects', 'purchaseOrders'],
  )
  // The list page alone does not open a detail result.
  assert.deepEqual(ids(['equipment', 'drivers', 'purchasing/orders']), [])
  // «اضف للبحث العام صفحة استعلام عن معدة»: the inquiry alone opens units.
  assert.deepEqual(ids(['inquiry']), ['equipment'])
  // App passes the shell's open pages; with no `opens` there is no search.
  assert.match(
    read('src', 'App.tsx'),
    /opens=\{\(target\) => shell\.pages\.has\(target\)\}/,
  )
  assert.match(header, /\{opens && \(/)
})

test('a term needs two characters and is sanitised', () => {
  assert.equal(search.globalSearchTerm(' a '), null)
  assert.equal(search.globalSearchTerm('A2'), 'A2')
  assert.equal(search.globalSearchTerm('a,(b)'), 'a b')
})

test('each result opens its page', () => {
  const all = (page) =>
    [
      'equipment/:id',
      'inquiry',
      'drivers/:id',
      'projects',
      'purchasing/:id',
    ].includes(page)
  const item = (group, row, opens = all) =>
    JSON.parse(
      JSON.stringify(
        search.globalSearchItem(group, row, 'ar', opens, 'المورد'),
      ),
    )
  const unit = {
    id: 'e1',
    code: 'A291',
    type: 'WHEEL LOADER',
    plate_number: '1128 XVV',
    chassis_number: null,
  }
  // Both pages open: the unit page, with its inquiry beside it.
  assert.deepEqual(item('equipment', unit), {
    id: 'e1',
    title: 'A291',
    detail: 'WHEEL LOADER · 1128 XVV',
    href: '/equipment/e1',
    ltr: true,
    inquiryHref: '/inquiry?equipment=e1',
  })
  // The unit page alone: no inquiry link.
  assert.equal(
    item('equipment', unit, (page) => page === 'equipment/:id').inquiryHref,
    undefined,
  )
  // The inquiry alone (a foreman, say): the result IS the inquiry.
  const inquiryOnly = item('equipment', unit, (page) => page === 'inquiry')
  assert.equal(inquiryOnly.href, '/inquiry?equipment=e1')
  assert.equal(inquiryOnly.inquiryHref, undefined)
  assert.match(component, /item\.inquiryHref && \(/)
  assert.match(component, /t\('globalSearchInquiryFor'\)/)
  assert.equal(
    item('drivers', { id: 'd1', full_name: 'احمد', mobile_number: '055' }).href,
    '/drivers/d1',
  )
  assert.equal(
    item('projects', { id: 'p1', name_ar: 'طريق الخرج', name_en: null }).href,
    `/projects?q=${encodeURIComponent('طريق الخرج').replace(/%20/g, '+')}`,
  )
  assert.deepEqual(
    item('purchaseOrders', { id: 'po1', po_number: 'PO-2026110004' }),
    {
      id: 'po1',
      title: 'PO-2026110004',
      detail: 'المورد',
      href: '/purchasing/po1',
      ltr: true,
    },
  )
})

test('the reads are bounded, server-side and fail per group', () => {
  assert.equal(search.GLOBAL_SEARCH_GROUP_LIMIT, 5)
  assert.equal(search.GLOBAL_SEARCH_DEBOUNCE_MS, 300)
  assert.match(data, /\.or\(filter\)/)
  assert.match(data, /\.limit\(GLOBAL_SEARCH_GROUP_LIMIT\)/)
  assert.match(data, /\.abortSignal\(signal\)/)
  assert.match(data, /unwrapRows\(/)
  assert.match(data, /items: \[\], failed: true/)
  assert.doesNotMatch(data, /select\('\*'\)/)
  for (const group of search.GLOBAL_SEARCH_GROUPS)
    assert.doesNotMatch(group.select, /\*/)
  // A failed group says so; it is never «no results».
  assert.match(component, /t\('globalSearchPartialError'\)/)
  assert.match(component, /shown\.length === 0 && !someFailed/)
})

test('Ctrl K, the arrows and Escape; results are real links', () => {
  assert.match(
    component,
    /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key\.toLowerCase\(\) === 'k'/,
  )
  assert.match(component, /event\.key === 'ArrowDown'/)
  assert.match(component, /event\.key === 'Escape'/)
  assert.match(component, /<AppLink\s+href=\{item\.href\}/)
  // The hint's direction on its inner text only (logical «end» stays put).
  assert.match(component, /<span dir="ltr">Ctrl K<\/span>/)
})

test('new copy: Arabic and English keys, no hamza alif', () => {
  const translations = read('src', 'i18n', 'translations.ts')
  const blocks = translations.split('// app-header-v2 — start')
  assert.equal(blocks.length, 3)
  const ar = blocks[1].split('// app-header-v2 — end')[0]
  const en = blocks[2].split('// app-header-v2 — end')[0]
  const keys = (block) => [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1])
  assert.deepEqual(keys(ar), keys(en))
  assert.doesNotMatch(ar, /[أإآ]/)
  assert.doesNotMatch(component + header, /[أإآ]/)
})
