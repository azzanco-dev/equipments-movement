// /ui-kit «نموذج الرئيسية الجديدة v2 (من الصور المرجعية)» (owner 2026-11-08,
// EM-252): the admin home rebuilt in the layout and density of four reference
// dashboards, on the project tokens and our own data domains only, registered
// for review with two densities.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const mockup = read('src', 'screens', 'ui-kit', 'HomeDashboardV2Mockup.tsx')
// The code without its comments (the header comment names what was left out).
const code = mockup
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

// Approved 2026-11-09 («اعتمد الرئيسية الي في ui-kit»): variant «ب» is live.
test('the mockup is an approved /ui-kit section, listed first', () => {
  const kit = read('src', 'screens', 'UiKit.tsx')
  assert.match(
    kit,
    /import \{ HomeDashboardV2Mockup \} from '@\/screens\/ui-kit\/HomeDashboardV2Mockup'/,
  )
  assert.match(
    kit,
    /const SCREEN_SECTIONS: SectionDef\[\] = \[\r?\n  \{[\s\S]*?id: 'home-dashboard-v2',\r?\n    title: 'نموذج الرئيسية الجديدة v2 \(من الصور المرجعية\)',[\s\S]*?status: 'approved',[\s\S]*?element: <HomeDashboardV2Mockup \/>/,
  )
})

test('two densities on the same data, switched with the shared Tabs', () => {
  assert.match(mockup, /type Variant = 'compact' \| 'roomy'/)
  assert.match(mockup, /const DENSITY: Record<Variant, Density>/)
  assert.match(
    mockup,
    /<TabsList variant="segmented" aria-label="نسخة الرئيسية">/,
  )
})

test('the blocks of our own data, each with an English subtitle', () => {
  for (const title of [
    'حالة الاسطول',
    'المشاريع الاكثر معدات',
    'الورشة حسب الغرض',
    'اخر الحركات',
    'يحتاج انتباهك',
    'التوفر حسب النوع',
    'التتبع في افاقي',
    'الدخول والخروج اليومي',
  ])
    assert.ok(mockup.includes(`title="${title}"`), title)
  for (const en of [
    'Fleet status',
    'Latest gate movements',
    'Needs attention',
    'Availability by type',
  ])
    assert.ok(mockup.includes(`en="${en}"`), en)
  // Figures count up, charts come only through the lazy wrappers.
  assert.match(
    mockup,
    /import \{ CountUp \} from '@\/components\/admin-home\/CountUp'/,
  )
  assert.match(mockup, /from '@\/components\/charts\/lazy'/)
  assert.doesNotMatch(mockup, /from 'recharts'/)
})

test('static: no Supabase, no fetch', () => {
  assert.doesNotMatch(code, /supabase|fetch\(/i)
})

test("none of the images' modules the program does not have", () => {
  for (const absent of [
    /وقود|Fuel/i,
    /مخزون|Inventory|Stock/i,
    /الموارد البشرية|\bHR\b/,
    /طلبات صيانة|Work ?Orders?/i,
    /ايرادات|Revenue|التكاليف التشغيلية|Operating costs/i,
    /خريطة|\bMap\b|Location/,
    /مستندات منتهية|Expiring/i,
    /Inspection|التفتيش/i,
  ])
    assert.doesNotMatch(code, absent)
})

test('tokens only, no hamza alif, no uppercase', () => {
  assert.doesNotMatch(
    mockup,
    /\b(gray|slate|zinc|neutral|stone|red|green|amber|yellow|blue|emerald|indigo|teal|rose|orange|purple|violet|sky|lime|pink)-\d{2,3}\b/,
  )
  assert.doesNotMatch(mockup, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(mockup, /rgba?\(|hsla?\(/)
  assert.doesNotMatch(
    mockup,
    /bg-white|text-white|bg-black|text-black|gradient/,
  )
  assert.doesNotMatch(mockup, /[أإآ]/)
  assert.doesNotMatch(mockup, /uppercase|tracking-/)
})
