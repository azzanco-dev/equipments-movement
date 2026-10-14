// /ui-kit arrangement (section index + collapsible shells) and the roles &
// permissions page MOCKUP. Source checks only: the mockup is review material
// with in-memory sample data, so it must never import Supabase, and all new
// Arabic copy uses the plain alif (AGENTS.md).
const assert = require('node:assert/strict')
const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const root = (path) => join(__dirname, '..', path)
const read = (path) => readFileSync(root(path), 'utf8')

const MOCKUP = 'src/screens/ui-kit/RolesPageMockup.tsx'
const DATA = 'src/screens/ui-kit/rolesMockupData.ts'
const LAYOUT = 'src/screens/ui-kit/UiKitLayout.tsx'
const PAGE = 'src/screens/UiKit.tsx'

test('the roles mockup and its sample data exist', () => {
  assert.ok(existsSync(root(MOCKUP)), `${MOCKUP} exists`)
  assert.ok(existsSync(root(DATA)), `${DATA} exists`)
  assert.ok(existsSync(root(LAYOUT)), `${LAYOUT} exists`)
})

test('the mockup never reaches Supabase or the real roles page', () => {
  for (const file of [MOCKUP, DATA, LAYOUT]) {
    const source = read(file)
    assert.doesNotMatch(
      source,
      /from ['"][^'"]*supabase[^'"]*['"]/i,
      `${file} has no Supabase import`,
    )
    assert.doesNotMatch(source, /createClient\(/, `${file} opens no client`)
    assert.doesNotMatch(
      source,
      /components\/roles\//,
      `${file} does not import the real roles components`,
    )
    assert.doesNotMatch(source, /\bfetch\(/, `${file} makes no requests`)
  }
})

test('new Arabic copy uses the plain alif (no أ / إ / آ)', () => {
  for (const file of [MOCKUP, DATA, LAYOUT, PAGE]) {
    const source = read(file)
    const lines = source
      .split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => /[أإآ]/.test(line))
    assert.deepEqual(
      lines,
      [],
      `${file} has alif with hamza/madda on lines ${lines.map(([n]) => n).join(', ')}`,
    )
  }
})

test('the sample permission catalogue mirrors migration 0126 without the map', () => {
  const data = read(DATA)
  // Permission keys are dotted; the role keys in the same file are not.
  const keys = [...data.matchAll(/^\s{4}key: '([a-z_]+\.[a-z_.]+)',$/gm)].map(
    (m) => m[1],
  )
  assert.equal(new Set(keys).size, keys.length, 'keys are unique')
  assert.ok(keys.includes('movements.read'))
  assert.ok(keys.includes('settings.roles'))
  assert.ok(keys.includes('purchasing.view'))
  assert.ok(keys.includes('purchasing.manage'))
  assert.ok(!keys.includes('map.view'), '«خريطة المشاريع» is omitted')
  assert.equal(keys.length, 46, 'all 0126 keys except map.view')
  assert.match(data, /key: 'purchasing', name: 'لاحقاً', collapsed: true/)
})

test('UiKit.tsx renders the section index and the three groups', () => {
  const page = read(PAGE)
  assert.match(page, /<UiKitIndex[\s\S]*variant="side"/)
  assert.match(page, /<UiKitIndex[\s\S]*variant="chips"/)
  for (const title of ['نماذج الشاشات', 'المكونات', 'الالوان والرموز']) {
    assert.ok(page.includes(title), `group «${title}» is present`)
  }
  assert.match(page, /<UiKitGroup[\s\S]*id="group-screens"/)
  assert.match(page, /<UiKitGroup[\s\S]*id="group-components"/)
  assert.match(page, /<UiKitGroup[\s\S]*id="group-colors"/)
  // The roles mockup opens the screens group (SCREEN_SECTIONS order).
  const roles = page.indexOf('<RolesPageMockup')
  const home = page.indexOf('<HomeMockupShowcase')
  const inquiry = page.indexOf('<EquipmentInquiryShowcase')
  assert.ok(roles > -1 && roles < home && home < inquiry, 'roles mockup first')
  assert.match(page, /id: 'roles-mockup',[\s\S]*defaultOpen: true/)
})

test('section shells remember their state safely and are anchored', () => {
  const layout = read(LAYOUT)
  assert.match(layout, /localStorage\.getItem/)
  assert.match(layout, /localStorage\.setItem/)
  assert.ok(
    (layout.match(/try \{/g) ?? []).length >= 2,
    'storage access is wrapped in try/catch',
  )
  assert.match(layout, /new IntersectionObserver\(/)
  assert.match(layout, /scrollIntoView\(\{ behavior: 'smooth'/)
  assert.match(layout, /<details[\s\S]*id=\{id\}/)
})
