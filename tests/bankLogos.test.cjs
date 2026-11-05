const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Owner 2026-11-05: «ابغاك تضيف شعارات البنوك، اول سويها في ui-kit». The
// logos of public/banks/ (downloaded with his OK from each bank's website)
// on a /ui-kit mockup only.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const lib = (() => {
  const source = path.join(ROOT, 'src', 'lib', 'bankLogos.ts')
  const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, Map, Object })
  return exports
})()

test('every mapped logo is a file of public/banks/, every file is mapped', () => {
  const files = fs.readdirSync(path.join(ROOT, 'public', 'banks')).sort()
  const mapped = Object.values(lib.BANK_LOGOS).map((logo) => logo.src.replace('/banks/', '')).sort()
  assert.deepEqual(mapped, files)
  for (const file of files) assert.match(file, /^[a-z0-9]+\.(svg|png|webp)$/)
})

test('the SVG logos carry no script, handler or outside link', () => {
  for (const file of fs.readdirSync(path.join(ROOT, 'public', 'banks')).filter((f) => f.endsWith('.svg'))) {
    const svg = read('public', 'banks', file)
    assert.doesNotMatch(svg, /<script|\son[a-z]+=|javascript:|<foreignObject|href="https?:/i, file)
  }
})

test('the lookup by name, the white logos and the initials', () => {
  assert.equal(lib.bankLogoOf('مصرف الانماء').src, '/banks/alinma.svg')
  assert.equal(lib.bankLogoOf('مصرف  الانماء').onDark, true)
  // All 13 banks of 0177 have a logo since the owner's «جيبهم بطريقتك».
  assert.equal(Object.keys(lib.BANK_LOGOS).length, 13)
  assert.equal(lib.bankLogoOf('مصرف الراجحي').src, '/banks/rajhi.svg')
  assert.equal(lib.bankLogoOf('بنك جديد'), null)
  assert.equal(lib.bankLogoOf(null), null)
  assert.equal(lib.bankInitials('مصرف الراجحي'), 'ر')
  assert.equal(lib.bankInitials('البنك العربي الوطني'), 'عو')
  assert.equal(lib.bankInitials('بنك الجزيرة'), 'ج')
})

test('the tile: white (dark for a white logo) in both themes, initials on the surface', () => {
  const tile = read('src', 'components', 'banks', 'BankLogo.tsx')
  assert.ok(tile.includes("'bg-[var(--surface)]'"))
  assert.ok(tile.includes("'border-transparent bg-[var(--logo-tile-dark)]'"))
  assert.ok(tile.includes("'bg-[var(--logo-tile)]'"))
  const css = read('src', 'index.css')
  assert.equal(css.match(/ {2}--logo-tile: #ffffff;/g).length, 2)
  assert.equal(css.match(/ {2}--logo-tile-dark: #1f2937;/g).length, 2)
})

test('reviewed on /ui-kit only: no screen uses the logos yet', () => {
  const kit = read('src', 'screens', 'UiKit.tsx')
  assert.ok(kit.includes("id: 'bank-logos'"))
  assert.ok(kit.includes('element: <BankLogosMockup />'))
  const users = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && /BankLogo|bankLogos/.test(fs.readFileSync(full, 'utf8')))
        users.push(path.relative(ROOT, full).split(path.sep).join('/'))
    }
  }
  walk(path.join(ROOT, 'src'))
  assert.deepEqual(users.sort(), [
    'src/components/banks/BankLogo.tsx',
    'src/lib/bankLogos.ts',
    'src/screens/UiKit.tsx',
    'src/screens/ui-kit/BankLogosMockup.tsx',
  ])
})
