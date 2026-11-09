// /ui-kit «نموذج الهيدر الجديد (من الصور المرجعية)» (owner 2026-11-08): the
// app header with the logo and its icons, after the reference dashboards,
// approved the same day as «ب» (the logo in a block as wide as the sidebar),
// the WhatsApp gateway state staying in the sidebar.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const mockup = read('src', 'screens', 'ui-kit', 'AppHeaderV2Mockup.tsx')
// The code without its comments (the header comment names what was left out).
const code = mockup
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

test('the mockup is an approved /ui-kit section, listed first', () => {
  const kit = read('src', 'screens', 'UiKit.tsx')
  assert.match(
    kit,
    /import \{ AppHeaderV2Mockup \} from '@\/screens\/ui-kit\/AppHeaderV2Mockup'/,
  )
  assert.match(
    kit,
    /const SCREEN_SECTIONS: SectionDef\[\] = \[\r?\n  \{\r?\n(    \/\/.*\r?\n)*    id: 'app-header-v2',\r?\n    title: 'نموذج الهيدر الجديد \(من الصور المرجعية\)',[\s\S]*?status: 'approved',[\s\S]*?element: <AppHeaderV2Mockup \/>/,
  )
})

test('two variants, the general search with Ctrl K, the user menu', () => {
  assert.match(code, /type Variant = 'bar' \| 'column'/)
  assert.match(code, /aria-label="نسخة الهيدر"/)
  assert.match(code, /event\.ctrlKey \|\| event\.metaKey/)
  assert.ok(code.includes('ابحث عن معدة، سائق، مشروع او PO'))
  assert.match(code, /<DropdownMenu>/)
  assert.ok(code.includes('تسجيل الخروج'))
  assert.ok(code.includes('/azzanco-logo-full.png'))
})

test('the approved variant opens first; WhatsApp stays out of the header', () => {
  assert.match(code, /useState<Variant>\('column'\)/)
  assert.ok(code.includes('(المعتمد)'))
  // «بوابة الواتس خليها نفس مكانها»: shown only in the sample sidebar.
  const header = code.slice(
    code.indexOf('function DateChip'),
    code.indexOf('const NAV = ['),
  )
  assert.doesNotMatch(header, /واتساب|MessageCircle|WhatsApp/)
  // Shown in the sample sidebar with the real card's look (owner 2026-11-08,
  // «اضف عبارة تحتها ultramsg … gradient noisy»).
  assert.match(code, /wa-gateway-card/)
  assert.ok(code.includes('ultramsg'))
})

test('nothing the owner kept out of the bar, nothing we do not have', () => {
  // No movement entry, no attention count, no notifications.
  assert.doesNotMatch(code, /تسجيل (دخول|خروج) معدة|حركة جديدة|انشاء جديد\s*</)
  assert.doesNotMatch(code, /يحتاج انتباهك/)
  assert.doesNotMatch(code, /\bBell\b|\bMail\b|Inbox/)
  assert.doesNotMatch(code, /supabase|fetch\(/i)
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
  // Logical directions only.
  assert.doesNotMatch(code, /\b(ml|mr|pl|pr|left|right)-\d/)
})
